import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MasterService, ToastService } from 'jp-shared/core';
import { Lookup, MASTER_KEYS } from 'jp-shared/models';
import {
  UiBadgeComponent,
  UiButtonComponent,
  UiComboboxComponent,
  UiEmptyStateComponent,
  UiModalComponent,
  UiMultiSelectComponent,
  lookupsToOptions,
} from 'jp-shared/ui';

import {
  JobBrowseCounts,
  JobBrowseItem,
  JobBrowseMode,
  JobSearchService,
  applyRefusalMessage,
} from '../../../../core/job-search.service';
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
 * `t_app_saved_jobs` (2.56). Applying is the act of consent.
 *
 * ⚠️ THIS PARAGRAPH USED TO END "and it happens on the job's own page where
 * the consequence can be stated". P5 moved the entry point onto the card, and
 * the clause that mattered came with it: the card opens a sheet that NAMES THE
 * JOB and states the consequence before anything is sent. What 2.56 protects
 * is that the consent is informed and deliberate — not which page it is given
 * on. There is still no bulk apply, and there never will be: one application
 * is one considered act.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THREE TABS, AND THEY ARE THREE SERVER QUERIES (P5)
 * ----------------------------------------------------------------------------
 * "Matches your profile" is the strict match, "You might like" is the loose one
 * minus the strict, and "Preferred locations" reads the saved locations that
 * nothing had read until now. The second tab's subtraction happens in SQL — a
 * client-side version would have to hold every job in the browser to know what
 * to hide, which would make both the page size and the tab counts fiction.
 */
@Component({
  selector: 'app-job-browse',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    RouterLink,
    UiBadgeComponent,
    UiButtonComponent,
    UiComboboxComponent,
    UiEmptyStateComponent,
    UiModalComponent,
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
  protected readonly qualifications = signal<Lookup[]>([]);

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
  protected readonly qualificationOptions = computed(() => lookupsToOptions(this.qualifications()));
  protected readonly employmentTypeOptions = computed(() => lookupsToOptions(this.employmentTypes()));

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

  /*
    P4. QUALIFICATION JOINS THE PRE-FILL.

    ⚠️ A SET ON THE WIRE THOUGH THE PROFILE HOLDS ONE. `TeacherProfile` carries
    a single `qualificationId`, and this could have been a scalar — but the
    server takes a table-valued parameter here like every other set filter, and
    a teacher listing two qualifications is a change to the profile alone if
    the wire is already plural. The one-element array is the cheap half of that.
  */
  protected readonly qualificationIds = signal<number[]>([]);

  // ---- P5: the three tabs ---------------------------------------------------

  /*
    🔴 THE ACTIVE TAB IS A SERVER QUERY, NOT A VIEW OF ONE RESULT SET.

    Switching tabs re-asks the server. "You might like" is a different
    predicate (ANY of the teacher's dimensions, MINUS everything the strict tab
    already returned), and the subtraction cannot be done here without
    downloading every job to find out what to hide — at which point the page
    size stops meaning anything and the tab's count counts downloads.
  */
  protected readonly mode = signal<JobBrowseMode>('matches');

  /**
   * How many jobs sit behind each tab.
   *
   * ⚠️ NULL UNTIL THE FIRST COUNT ARRIVES, and null again if the count call
   * fails. The labels then simply carry no number rather than claiming zero —
   * "Matches your profile (0)" next to a list of twelve jobs is worse than no
   * number at all.
   */
  protected readonly counts = signal<JobBrowseCounts | null>(null);

  // ---- P5: keyword search ---------------------------------------------------

  /**
   * What the teacher typed, as submitted — NOT as they type.
   *
   * ⚠️ TWO SIGNALS ON PURPOSE. `keywordInput` is the box; `keyword` is the
   * search that is actually running. Binding the request to the box would fire
   * a query per keystroke and make the back-to-tabs control flicker in and out
   * of existence while somebody is still typing.
   */
  protected readonly keywordInput = signal('');
  protected readonly keyword = signal('');

  /**
   * 🔴 A SEARCH REPLACES THE TABS, it does not narrow one.
   *
   * Somebody typing a school's name has stopped browsing their profile's
   * matches. A keyword applied inside the current tab would answer "no
   * results" for a job that plainly exists, and the teacher has no way to know
   * the tab was still in force.
   */
  protected readonly searching = computed(() => this.keyword().length > 0);

  // ---- P5: applying from the card -------------------------------------------

  /**
   * The job whose apply sheet is open, or null.
   *
   * 🔒 THE SHEET IS 2.56's "CONSEQUENCE STATED", MOVED — NOT DROPPED. Applying
   * is consent, and until now it could only happen on the job's own page
   * because that is where the consequence could be written down. The card now
   * opens a sheet that names the job and says the same thing before anything
   * is sent, so the guarantee is intact and the extra page-load is not.
   *
   * 🔒 ONE JOB AT A TIME, AND NO BULK APPLY. This is a single row, never a
   * selection — one application is one considered act, and a checkbox column
   * with "Apply to 12 jobs" would be the exact thing 2.56 forbids.
   */
  protected readonly applyTarget = signal<JobBrowseItem | null>(null);
  protected readonly applyBusy = signal(false);
  protected readonly applyCoverNote = signal('');

  /** `RESUME_REQUIRED` / `JOB_EXPIRED`, shown inside the sheet. See `confirmApply`. */
  protected readonly applyRefusal = signal<string | null>(null);

  protected readonly applyResumeMissing = computed(() => this.applyRefusal() === 'RESUME_REQUIRED');
  protected readonly applyExpired = computed(() => this.applyRefusal() === 'JOB_EXPIRED');

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

  /**
   * P5. Whether the three tabs are in force right now.
   *
   * 🔴 THE TABS ONLY EXIST WHILE THE LIST IS THE PROFILE'S. They are three
   * views of "work that suits you", so they are meaningless once the teacher
   * has cleared the filters, taken them over, or typed a search — in each of
   * those cases the list is theirs and the server gets no mode at all.
   */
  protected readonly tabsApply = computed(() => this.matchedToProfile() && !this.searching());

  constructor() {
    this.masters.get(MASTER_KEYS.subject).subscribe((v) => this.subjects.set(v));
    this.masters.get(MASTER_KEYS.designation).subscribe((v) => this.designations.set(v));
    this.masters.get(MASTER_KEYS.state).subscribe((v) => this.states.set(v));
    this.masters.get(MASTER_KEYS.city).subscribe((v) => this.cities.set(v));
    this.masters.get(MASTER_KEYS.classLevel).subscribe((v) => this.classLevels.set(v));
    this.masters.get(MASTER_KEYS.qualification).subscribe((v) => this.qualifications.set(v));

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

        /*
          🔴 P5. THE STATE IS NO LONGER SENT FROM HERE, AND THAT IS NOT A
          REGRESSION — IT IS THE ONLY WAY THE THREE TABS CAN BE HONEST.

          `stateId` is the TOOLBAR's filter, and the server applies it to all
          three modes. Pre-filling it from the profile would therefore narrow
          "Preferred locations" to the one state the teacher is trying to look
          beyond — the tab named after the places they chose would be the tab
          that ignored them. Worse, the counts take the same filter as the
          lists, so all three numbers would be computed under a state that only
          one of the three tabs should ever see.

          So MATCHES resolves its state SERVER-SIDE from the teacher's own
          `CurrentStateId`, from the token, and this control is left for the
          teacher's own use.

          ⚠️ IT ALSO CHANGED WHICH STATE "MATCHES" MEANS. It used to be the top
          preferred location's state — where they want to work. It is now where
          they live, and the tabs are what makes that right: tab 1 is work near
          you, tab 3 is the places you asked for. One state could never have
          said both.
        */
        const topLocationState = topLocation?.stateId ?? null;

        /*
          P4. The profile's qualification joins the pre-fill, as a one-element
          set — see `qualificationIds`.
        */
        const qualificationIds = profile.qualificationId ? [profile.qualificationId] : [];

        if (
          subjectIds.length === 0
          && classLevelIds.length === 0
          && qualificationIds.length === 0
          && topLocationState === null
        ) {
          /*
            ⚠️ AN EMPTY PROFILE SEES EVERYTHING, AND SEES NO TABS. There is
            nothing to match against, so "Matches your profile" would be an
            empty tab that can never fill — which reads as a broken product
            rather than an unfinished profile.
          */
          this.load();
          this.loadCounts();
          return;
        }

        this.subjectIds.set(subjectIds);
        this.classLevelIds.set(classLevelIds);
        this.qualificationIds.set(qualificationIds);
        this.matchedToProfile.set(true);

        this.load();
        this.loadCounts();
      },
      error: () => {
        this.load();
        this.loadCounts();
      },
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

  /*
    ⚠️ THE QUALIFICATION FILTER IS VISIBLE, not an invisible part of the match.
    P4 pre-fills it from the profile, and a filter that narrows the list without
    appearing in the toolbar is the silent pre-filter this screen's banner
    exists to prevent — one dimension of it, hidden.
  */
  protected onQualificationsChange(values: (string | number)[]): void {
    this.qualificationIds.set(this.toIds(values));
    this.onFilterChange();
  }

  // ---- P5: applying from the card ------------------------------------------

  /**
   * Open the apply sheet for one job.
   *
   * ⚠️ The card is a link to the job; this control inside it is not.
   */
  protected openApply(row: JobBrowseItem, event: Event): void {
    event.stopPropagation();
    event.preventDefault();

    this.applyTarget.set(row);
    this.applyCoverNote.set('');
    this.applyRefusal.set(null);
  }

  protected closeApply(): void {
    this.applyTarget.set(null);
    this.applyCoverNote.set('');
    this.applyRefusal.set(null);
  }

  /**
   * Send the application.
   *
   * 🔒 THE SAME CALL AND THE SAME RULES AS THE JOB'S OWN PAGE (2.56). The
   * resume requirement, the double-tap resolution and the refusal codes all
   * belong to the server; this is a second entry point to one act, not a
   * second way of applying.
   */
  protected confirmApply(): void {
    const job = this.applyTarget();

    if (!job) return;

    this.applyBusy.set(true);
    this.applyRefusal.set(null);

    this.jobs.apply(job.jobId, this.applyCoverNote().trim() || null).subscribe({
      next: (result) => {
        this.applyBusy.set(false);

        /*
          ⚠️ BOTH OUTCOMES ARE SUCCESS. `created: false` with ALREADY_APPLIED is
          a double-tap resolving to the application they already have — the same
          reasoning, and the same two sentences, as the detail page.
        */
        this.toast.success(
          result.created
            ? 'Applied. The school can now see your profile and contact you.'
            : 'You had already applied to this job — nothing was sent twice.',
        );

        /*
          ⚠️ THE ROW IS UPDATED IN PLACE, NOT RE-FETCHED. Re-running the browse
          would re-page and could move the card the teacher is looking at — and
          in the "Matches your profile" tab a reload can legitimately return a
          different set. `hasApplied` is the only thing that changed.
        */
        this.rows.update((rows) =>
          rows.map((r) => (r.jobId === job.jobId ? { ...r, hasApplied: true } : r)),
        );

        this.closeApply();
      },
      error: (err) => {
        this.applyBusy.set(false);

        const code = err?.error?.code ?? null;

        /*
          ⚠️ THESE TWO ARE RENDERED INSIDE THE SHEET, not as a toast. Both are
          things the teacher can act on — one links to the resume, the other
          says the posting closed — and a toast that scrolls away while the
          sheet is still open would leave them looking at an Apply button with
          no explanation.
        */
        if (code === 'RESUME_REQUIRED' || code === 'JOB_EXPIRED') {
          this.applyRefusal.set(code);
          return;
        }

        this.toast.error(applyRefusalMessage(code, 'That application could not be sent.'));
      },
    });
  }

  /** "Show all jobs" — the way out of the pre-filtered list, and out of the tabs. */
  protected showAll(): void {
    this.matchedToProfile.set(false);
    this.clearFilters();
  }

  // ---- P5: tabs, counts and search -----------------------------------------

  protected setMode(mode: JobBrowseMode): void {
    if (mode === this.mode()) return;

    this.mode.set(mode);
    this.page.set(1);
    this.load();
  }

  /**
   * Refresh the three tab counts for the filters currently in force.
   *
   * ⚠️ CALLED WHEREVER THE FILTERS MOVE, not on a timer and not per tab. The
   * counts describe one filter at one moment; refreshing them on a tab switch
   * instead would let the three numbers drift apart, which is how a tab ends
   * up promising twelve jobs and showing nine.
   */
  protected loadCounts(): void {
    this.jobs
      .browseCounts({
        subjectIds: this.subjectIds(),
        classLevelIds: this.classLevelIds(),
        qualificationIds: this.qualificationIds(),
        employmentTypeId: this.employmentTypeId(),
        stateId: this.stateId(),
      })
      .subscribe({
        next: (counts) => this.counts.set(counts),

        // No toast: see `counts`. The labels lose their numbers, nothing else.
        error: () => this.counts.set(null),
      });
  }

  protected submitKeyword(): void {
    const next = this.keywordInput().trim();

    if (next === this.keyword()) return;

    this.keyword.set(next);
    this.page.set(1);
    this.load();
  }

  /** The way back from "Search results" to the tabs. */
  protected clearKeyword(): void {
    if (!this.keyword() && !this.keywordInput()) return;

    this.keywordInput.set('');
    this.keyword.set('');
    this.page.set(1);
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.jobs
      .browse({
        subjectIds: this.subjectIds(),
        classLevelIds: this.classLevelIds(),
        qualificationIds: this.qualificationIds(),
        employmentTypeId: this.employmentTypeId(),
        stateId: this.stateId(),

        /*
          ⚠️ NO MODE WHILE SEARCHING. A keyword replaces the tabs (see
          `searching`), and sending both would answer "no results" for a job
          that exists but sits in another tab.

          ⚠️ AND NO MODE ONCE THE TEACHER HAS TAKEN THE FILTERS OVER. The tabs
          describe a profile-shaped list; the moment somebody edits the filters
          themselves the list is theirs, and a mode still applying underneath
          would quietly subtract rows they asked for.
        */
        mode: this.tabsApply() ? this.mode() : undefined,
        keyword: this.keyword() || null,

        pageNumber: this.page(),
        pageSize: PAGE_SIZE,
      })
      .subscribe({
        next: (result) => {
          /*
            🔴 THE ONE-SHOT WIDENING IS GONE, AND THE TABS ARE WHY.

            This used to detect an empty profile-matched list and silently
            clear the filters, because an empty screen on arrival reads as
            "this product has no jobs for me". That reasoning was right and the
            remedy is now better: an empty "Matches your profile" sits beside
            "You might like (9)" with the count visible, so the way out is a
            thing the teacher chooses rather than something the screen does to
            them while they are reading it.

            ⚠️ AND THE OLD BEHAVIOUR WOULD NOW BE A BUG. Clearing the filters
            under somebody who just clicked a tab would move them out of the tab
            they picked, with the banner still explaining a state they left.
          */
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

    this.page.set(1);
    this.load();
    this.loadCounts();
  }

  protected clearFilters(): void {
    // ⚠️ No filters means the list is not the profile's any more, whoever cleared them.
    this.matchedToProfile.set(false);

    this.subjectIds.set([]);
    this.classLevelIds.set([]);
    this.qualificationIds.set([]);
    this.employmentTypeId.set(null);
    this.stateId.set(null);
    this.page.set(1);
    this.load();
    this.loadCounts();
  }

  protected readonly hasFilters = computed(
    () => this.subjectIds().length > 0
      || this.classLevelIds().length > 0
      || this.qualificationIds().length > 0
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
