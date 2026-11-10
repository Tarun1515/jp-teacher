import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MasterService, ToastService } from 'jp-shared/core';
import { Lookup, MASTER_KEYS } from 'jp-shared/models';
import {
  UiBadgeComponent,
  UiComboboxComponent,
  UiEmptyStateComponent,
  UiMultiSelectComponent,
  lookupsToOptions,
} from 'jp-shared/ui';

import { JobBrowseItem, JobSearchService } from '../../../../core/job-search.service';
import { TeacherService } from '../../../../core/teacher.service';

const PAGE_SIZE = 12;

/**
 * Find jobs.
 *
 * ----------------------------------------------------------------------------
 * 🔴 EVERY JOB ON THIS SCREEN IS OPEN, AND THE SERVER DECIDED THAT
 * ----------------------------------------------------------------------------
 * An Active posting past its closing date is EXPIRED by
 * `fn_EffectiveJobStatusId`, computed from the date in IST on every read. It
 * does not appear here, its detail page answers 404, and an apply is refused.
 *
 * ⚠️ NOTHING IN THIS COMPONENT COMPARES A DATE to decide what is open. A
 * machine with a wrong clock would otherwise show a teacher a job the server
 * will not let them apply to — which is the worst version of this bug, because
 * it wastes the applicant's time and looks like the product is broken.
 *
 * ----------------------------------------------------------------------------
 * 🔴 EVERY DROPDOWN IS A MASTER (2.7)
 * ----------------------------------------------------------------------------
 * Subject, designation, employment type and state all come from
 * `/api/masters/*`. The client renames a subject or adds an employment type as
 * DATA, with no deployment — which is the whole point of the decision, and the
 * reason there is no array of options in this file.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ SAVING IS NOT APPLYING
 * ----------------------------------------------------------------------------
 * The bookmark on a card is private to this teacher. It tells the school
 * nothing and unlocks nothing — `fn_TeacherContactUnlocked` does not read
 * `t_app_saved_jobs` (2.56). Applying is the act of consent, and it happens on
 * the job's own page where the consequence can be stated.
 */
@Component({
  selector: 'app-job-browse',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    RouterLink,
    UiBadgeComponent,
    UiComboboxComponent,
    UiEmptyStateComponent,
    UiMultiSelectComponent,
  ],
  templateUrl: './job-browse.component.html',
  styleUrl: './job-browse.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobBrowseComponent {
  private readonly jobs = inject(JobSearchService);
  private readonly masters = inject(MasterService);
  private readonly toast = inject(ToastService);
  private readonly teacher = inject(TeacherService);

  protected readonly rows = signal<JobBrowseItem[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly saving = signal<number | null>(null);

  protected readonly page = signal(1);

  // ---- masters -------------------------------------------------------------

  protected readonly subjects = signal<Lookup[]>([]);
  protected readonly employmentTypes = signal<Lookup[]>([]);
  protected readonly states = signal<Lookup[]>([]);
  protected readonly designations = signal<Lookup[]>([]);
  protected readonly cities = signal<Lookup[]>([]);
  protected readonly classLevels = signal<Lookup[]>([]);

  /*
    SR-3 (G27). The two LONG masters as combobox options.

    ⚠️ ONLY THESE TWO. Employment type stays a plain <select> — it has a
    handful of rows, and a search box over four options is a worse control than
    the four options. The combobox is for the lists you cannot scan, which here
    means subjects and (once the geography seed lands) every state in India.

    ⚠️ COMPUTED, NOT MAPPED IN THE TEMPLATE, so `options` keeps a stable
    identity between change-detection passes instead of handing the OnPush
    child a new array every time.
  */
  protected readonly subjectOptions = computed(() => lookupsToOptions(this.subjects()));
  protected readonly stateOptions = computed(() => lookupsToOptions(this.states()));
  protected readonly classLevelOptions = computed(() => lookupsToOptions(this.classLevels()));

  // ---- filters -------------------------------------------------------------

  /*
    🔴 SR-5. SUBJECTS AND CLASS LEVELS ARE SETS, NOT SINGLE VALUES.

    The client asked that a teacher sees work matching THEIR subjects and
    THEIR class levels — plural in both cases. A maths-and-physics teacher of
    classes 9-12 has two subjects and four levels, and a single-value filter
    cannot express that, so pre-filling one of them would be picking one at
    random and calling it their profile.

    ⚠️ THE CONTROL CHANGED WITH THE DATA. Subject moved from a single dropdown
    to <ui-multi-select>, because a toolbar that shows one subject while the
    list is filtered by three is lying about what the user is looking at.
  */
  protected readonly subjectIds = signal<number[]>([]);
  protected readonly classLevelIds = signal<number[]>([]);
  protected readonly employmentTypeId = signal<number | null>(null);
  protected readonly stateId = signal<number | null>(null);

  // ---- SR-3: starting from the teacher's own profile ------------------------

  /**
   * Whether the filters currently showing were set FROM THE PROFILE rather
   * than by the teacher.
   *
   * ⚠️ IT MUST BE SAID ON SCREEN, which is the whole reason this is a signal
   * and not a private boolean. A filtered list that the teacher did not filter
   * is indistinguishable from a product with very few jobs in it — they would
   * conclude there is no work for them and leave. The banner is not decoration;
   * it is the thing that makes a pre-filled list honest.
   */
  protected readonly matchedToProfile = signal(false);

  /** Set when the profile's own filters matched nothing and we widened. */
  protected readonly widenedAfterNoMatch = signal(false);

  /**
   * 🔴 GUARDS THE ONE-SHOT WIDENING BELOW, so it can never loop.
   *
   * Cleared the moment it is used. Without it, a profile that matches nothing
   * and an empty database would retry each other forever.
   */
  private profileFallbackPending = false;

  constructor() {
    this.masters.get(MASTER_KEYS.subject).subscribe((v) => this.subjects.set(v));
    this.masters.get(MASTER_KEYS.designation).subscribe((v) => this.designations.set(v));
    this.masters.get(MASTER_KEYS.state).subscribe((v) => this.states.set(v));
    this.masters.get(MASTER_KEYS.city).subscribe((v) => this.cities.set(v));
    this.masters.get(MASTER_KEYS.classLevel).subscribe((v) => this.classLevels.set(v));

    /*
      ⚠️ Through the SAME MasterService and the same one-hour cache as the four
      above, even though this key is answered by jp_app rather than jp_mdm. A
      component asking for a dropdown has no business knowing which database
      replied (2.68 / G26).
    */
    this.masters.get(MASTER_KEYS.employmentType).subscribe((v) => this.employmentTypes.set(v));

    this.startFromProfile();
  }

  /**
   * SR-3. Open this screen already pointed at the work this teacher does.
   *
   * ----------------------------------------------------------------------------
   * 🔴 WHY THE DEFAULT IS NOT "EVERYTHING"
   * ----------------------------------------------------------------------------
   * A maths teacher in Hisar landing on every open post in the country has to
   * do the product's work for it before the screen is worth anything. They
   * already told us their subject and where they want to work — asking again,
   * by making them pick it out of two dropdowns, is the kind of small tax that
   * decides whether somebody comes back.
   *
   * ⚠️ IT IS A DEFAULT, NOT A RESTRICTION. The banner says the list is filtered
   * and "Show all jobs" is one click away — because the failure mode of a
   * silent pre-filter is far worse than the failure mode of no filter: a
   * teacher concludes there is no work for them and leaves, and nothing on the
   * screen contradicts that.
   *
   * ⚠️ EMPLOYMENT TYPE IS DELIBERATELY NOT PRE-FILLED. Subject and state are
   * things a teacher states as facts about themselves; full-time vs part-time
   * is a trade-off most people will make differently for the right job, and
   * guessing it hides postings they would have taken.
   *
   * ⚠️ A FAILED PROFILE LOAD IS NOT AN ERROR HERE. Browsing jobs must work
   * before the profile endpoint does; it just means no defaults, and the
   * teacher sees the ordinary unfiltered list with no toast and no banner.
   */
  private startFromProfile(): void {
    this.teacher.getProfile().subscribe({
      next: (profile) => {
        /*
          ⚠️ ALL of them, not the first. This is the client's actual ask: a
          teacher of two subjects across four class levels should see work for
          two subjects across four class levels. Taking [0] would pick one at
          random and present it as "your profile".
        */
        const subjectIds = profile.subjectIds ?? [];
        const classLevelIds = profile.classLevelIds ?? [];

        /*
          ⚠️ SORTED BY preferenceOrder, not taken at index 0. The array arrives
          in whatever order the join produced, and "first preference" is a
          value in the row, not a position in the list.

          ⚠️ AND ONLY THE TOP ONE IS USED, unlike subjects. A teacher listing
          three states would otherwise see a list spanning all three, which is
          wider than "jobs near me" rather than narrower — and the state filter
          is the one people most expect to mean one place.
        */
        const topLocation = [...(profile.preferredLocations ?? [])].sort(
          (a, b) => a.preferenceOrder - b.preferenceOrder,
        )[0];

        const stateId = topLocation?.stateId ?? null;

        if (subjectIds.length === 0 && classLevelIds.length === 0 && stateId === null) {
          this.load();
          return;
        }

        this.subjectIds.set(subjectIds);
        this.classLevelIds.set(classLevelIds);
        this.stateId.set(stateId);
        this.matchedToProfile.set(true);
        this.profileFallbackPending = true;

        this.load();
      },
      error: () => this.load(),
    });
  }

  /**
   * Narrow `<ui-multi-select>`'s emission to the ids these filters are made of.
   *
   * ⚠️ THE COMPONENT IS TYPED `(string | number)[]` because it serves master
   * lists with either kind of key. Every option here comes from a `Lookup`, so
   * the values are always numbers — but the cast belongs in one named place
   * rather than scattered through the template, where `$any()` would silence
   * the checker without anyone recording why it was safe.
   */
  private toIds(values: readonly (string | number)[]): number[] {
    return values.map(Number).filter((n) => !Number.isNaN(n));
  }

  protected onSubjectsChange(values: (string | number)[]): void {
    this.subjectIds.set(this.toIds(values));
    this.onFilterChange();
  }

  protected onClassLevelsChange(values: (string | number)[]): void {
    this.classLevelIds.set(this.toIds(values));
    this.onFilterChange();
  }

  /** "Show all jobs" — the way out of the pre-filtered list. */
  protected showAll(): void {
    this.matchedToProfile.set(false);
    this.widenedAfterNoMatch.set(false);
    this.profileFallbackPending = false;
    this.clearFilters();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.jobs
      .browse({
        subjectIds: this.subjectIds(),
        classLevelIds: this.classLevelIds(),
        employmentTypeId: this.employmentTypeId(),
        stateId: this.stateId(),
        pageNumber: this.page(),
        pageSize: PAGE_SIZE,
      })
      .subscribe({
        next: (result) => {
          /*
            🔴 THE PROFILE'S FILTERS MATCHED NOTHING — WIDEN ONCE, AND SAY SO.

            An empty screen on arrival is the worst outcome of pre-filling.
            The teacher never chose these filters, so "no results" reads as
            "this product has no jobs for me" rather than "nothing matches the
            two boxes we filled in on your behalf". Falling back to everything
            and naming what happened turns a dead end into a sentence they can
            act on.

            ⚠️ ONCE, AND THE FLAG IS CLEARED BEFORE THE RETRY — so a genuinely
            empty result set stops here instead of two states calling each
            other forever.
          */
          if (this.profileFallbackPending && result.total === 0) {
            this.profileFallbackPending = false;
            this.widenedAfterNoMatch.set(true);
            this.clearFilters();
            return;
          }

          this.profileFallbackPending = false;

          this.rows.set(result.rows);
          this.total.set(result.total);
          this.loading.set(false);
        },
        error: () => {
          this.rows.set([]);
          this.total.set(0);
          this.loading.set(false);
          this.failed.set(true);
          this.toast.error('Jobs could not be loaded.');
        },
      });
  }

  protected onFilterChange(): void {
    /*
      ⚠️ THE TEACHER HAS TAKEN OVER, so the banner stops claiming the list is
      their profile's. Leaving it up would be the product taking credit for a
      choice the person just made themselves.
    */
    this.matchedToProfile.set(false);
    this.widenedAfterNoMatch.set(false);
    this.profileFallbackPending = false;

    this.page.set(1);
    this.load();
  }

  protected clearFilters(): void {
    /*
      ⚠️ No filters means the list is not the profile's any more, whoever
      cleared them. `widenedAfterNoMatch` is deliberately NOT reset here — the
      widening path sets it immediately before calling this, and that message
      has to survive the call that causes it.
    */
    this.matchedToProfile.set(false);

    this.subjectIds.set([]);
    this.classLevelIds.set([]);
    this.employmentTypeId.set(null);
    this.stateId.set(null);
    this.page.set(1);
    this.load();
  }

  protected readonly hasFilters = computed(
    () => this.subjectIds().length > 0
      || this.classLevelIds().length > 0
      || this.employmentTypeId() !== null
      || this.stateId() !== null,
  );

  // ---- paging (server-side) ------------------------------------------------

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  protected readonly rangeStart = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * PAGE_SIZE + 1,
  );

  protected readonly rangeEnd = computed(() => Math.min(this.page() * PAGE_SIZE, this.total()));

  protected readonly pageNumbers = computed(() =>
    Array.from({ length: this.totalPages() }, (_, i) => i + 1),
  );

  protected goToPage(page: number): void {
    const next = Math.max(1, Math.min(page, this.totalPages()));

    if (next === this.page()) return;

    this.page.set(next);

    // 🔴 Server-side paging: a page change is a new request, not a slice.
    this.load();
  }

  // ---- saving --------------------------------------------------------------

  protected toggleSaved(row: JobBrowseItem, event: Event): void {
    // The card is a link; the bookmark inside it is not.
    event.stopPropagation();
    event.preventDefault();

    this.saving.set(row.jobId);

    this.jobs.toggleSaved(row.jobId).subscribe({
      next: (result) => {
        this.saving.set(null);

        /*
          ⚠️ The SERVER's answer, not the opposite of what we had. Two taps in
          flight would otherwise leave the icon showing the wrong state with
          nothing to correct it.
        */
        this.rows.update((rows) =>
          rows.map((r) => (r.jobId === row.jobId ? { ...r, isSaved: result.isSaved } : r)),
        );

        this.toast.success(result.isSaved ? 'Saved.' : 'Removed from saved jobs.');
      },
      error: () => {
        this.saving.set(null);
        this.toast.error('That could not be saved.');
      },
    });
  }

  // ---- display -------------------------------------------------------------

  protected name(list: Lookup[], id: number | null | undefined): string {
    if (id === null || id === undefined) return '';

    return list.find((l) => l.id === id)?.name ?? '';
  }

  protected locationLabel(row: JobBrowseItem): string {
    const city = this.name(this.cities(), row.cityId);
    const state = this.name(this.states(), row.stateId);

    return [city, state].filter(Boolean).join(', ') || row.branchName;
  }

  protected salaryLabel(row: JobBrowseItem): string {
    if (row.salaryMin === null && row.salaryMax === null) {
      return row.isSalaryNegotiable ? 'Salary negotiable' : 'Salary not stated';
    }

    const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;

    const range =
      row.salaryMin !== null && row.salaryMax !== null
        ? `${fmt(row.salaryMin)} – ${fmt(row.salaryMax)}`
        : fmt((row.salaryMin ?? row.salaryMax) as number);

    return row.isSalaryNegotiable ? `${range} · negotiable` : range;
  }

  protected experienceLabel(row: JobBrowseItem): string {
    const min = row.minExperienceMonths;
    const max = row.maxExperienceMonths;

    if (min === null && max === null) return '';

    const years = (m: number) => (m % 12 === 0 ? `${m / 12}y` : `${Math.round((m / 12) * 10) / 10}y`);

    if (min !== null && max !== null) return `${years(min)}–${years(max)} experience`;
    if (min !== null) return `${years(min)}+ experience`;

    return `up to ${years(max as number)} experience`;
  }
}
