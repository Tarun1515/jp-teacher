import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MasterService, ToastService } from 'jp-shared/core';
import { Lookup, MASTER_KEYS } from 'jp-shared/models';
import { UiBadgeComponent, UiEmptyStateComponent } from 'jp-shared/ui';

import { JobBrowseItem, JobSearchService } from '../../../../core/job-search.service';

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
  imports: [FormsModule, DatePipe, RouterLink, UiBadgeComponent, UiEmptyStateComponent],
  templateUrl: './job-browse.component.html',
  styleUrl: './job-browse.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobBrowseComponent {
  private readonly jobs = inject(JobSearchService);
  private readonly masters = inject(MasterService);
  private readonly toast = inject(ToastService);

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

  // ---- filters -------------------------------------------------------------

  protected readonly subjectId = signal<number | null>(null);
  protected readonly employmentTypeId = signal<number | null>(null);
  protected readonly stateId = signal<number | null>(null);

  constructor() {
    this.masters.get(MASTER_KEYS.subject).subscribe((v) => this.subjects.set(v));
    this.masters.get(MASTER_KEYS.designation).subscribe((v) => this.designations.set(v));
    this.masters.get(MASTER_KEYS.state).subscribe((v) => this.states.set(v));
    this.masters.get(MASTER_KEYS.city).subscribe((v) => this.cities.set(v));

    /*
      ⚠️ Through the SAME MasterService and the same one-hour cache as the four
      above, even though this key is answered by jp_app rather than jp_mdm. A
      component asking for a dropdown has no business knowing which database
      replied (2.68 / G26).
    */
    this.masters.get(MASTER_KEYS.employmentType).subscribe((v) => this.employmentTypes.set(v));

    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.jobs
      .browse({
        subjectId: this.subjectId(),
        employmentTypeId: this.employmentTypeId(),
        stateId: this.stateId(),
        pageNumber: this.page(),
        pageSize: PAGE_SIZE,
      })
      .subscribe({
        next: (result) => {
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
    this.page.set(1);
    this.load();
  }

  protected clearFilters(): void {
    this.subjectId.set(null);
    this.employmentTypeId.set(null);
    this.stateId.set(null);
    this.page.set(1);
    this.load();
  }

  protected readonly hasFilters = computed(
    () => this.subjectId() !== null || this.employmentTypeId() !== null || this.stateId() !== null,
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
