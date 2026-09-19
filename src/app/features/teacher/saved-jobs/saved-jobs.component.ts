import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ToastService } from 'jp-shared/core';
import { Lookup, MASTER_KEYS } from 'jp-shared/models';
import { MasterService } from 'jp-shared/core';
import { UiBadgeComponent, UiEmptyStateComponent } from 'jp-shared/ui';

import { JobSearchService, SavedJob } from '../../../core/job-search.service';

/**
 * Saved jobs — the teacher's own private shortlist.
 *
 * ----------------------------------------------------------------------------
 * 🔒 SAVING IS NOT APPLYING, AND IT UNLOCKS NOTHING (2.56)
 * ----------------------------------------------------------------------------
 * Nothing on this screen has been shown to any school. `t_app_saved_jobs` is
 * read by nothing except this list: `fn_TeacherContactUnlocked` does not touch
 * it and must never be made to. Saving is interest; applying is consent, and
 * only the second one hands over a phone number.
 *
 * That is stated on the screen, not just in this comment — a shortlist that
 * might be visible to schools is a different product, and a teacher has no way
 * to tell the two apart by looking.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ A SAVED JOB CAN GO STALE, AND THE LIST SAYS SO RATHER THAN HIDING IT
 * ----------------------------------------------------------------------------
 * A posting saved last month may have closed since. `jobStatusId` is the
 * EFFECTIVE status from the server — expiry is derived from the date in IST, so
 * nothing in this component compares a date. A closed row stays visible and
 * recedes, because silently dropping it would leave somebody wondering what
 * happened to a job they remember saving.
 */
@Component({
  selector: 'app-saved-jobs',
  standalone: true,
  imports: [DatePipe, RouterLink, UiBadgeComponent, UiEmptyStateComponent],
  templateUrl: './saved-jobs.component.html',
  styleUrl: './saved-jobs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavedJobsComponent {
  private readonly jobs = inject(JobSearchService);
  private readonly masters = inject(MasterService);
  private readonly toast = inject(ToastService);

  /** Stored job statuses. 3 (Expired) is derived, never stored (4 / 014). */
  private readonly JOB_ACTIVE = 2;

  protected readonly rows = signal<SavedJob[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly busy = signal<number | null>(null);

  protected readonly subjects = signal<Lookup[]>([]);
  protected readonly designations = signal<Lookup[]>([]);
  protected readonly cities = signal<Lookup[]>([]);
  protected readonly states = signal<Lookup[]>([]);

  constructor() {
    this.masters.get(MASTER_KEYS.subject).subscribe((v) => this.subjects.set(v));
    this.masters.get(MASTER_KEYS.designation).subscribe((v) => this.designations.set(v));
    this.masters.get(MASTER_KEYS.city).subscribe((v) => this.cities.set(v));
    this.masters.get(MASTER_KEYS.state).subscribe((v) => this.states.set(v));

    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.jobs.savedJobs().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.rows.set([]);
        this.loading.set(false);
        this.failed.set(true);
        this.toast.error('Your saved jobs could not be loaded.');
      },
    });
  }

  protected remove(row: SavedJob): void {
    this.busy.set(row.jobId);

    this.jobs.toggleSaved(row.jobId).subscribe({
      next: (result) => {
        this.busy.set(null);

        /*
          ⚠️ The SERVER's answer decides. If it came back still saved — two taps
          crossing — the row stays rather than vanishing from a list it is still
          on.
        */
        if (!result.isSaved) {
          this.rows.update((rows) => rows.filter((r) => r.jobId !== row.jobId));
          this.toast.success('Removed from saved jobs.');
        } else {
          this.load();
        }
      },
      error: () => {
        this.busy.set(null);
        this.toast.error('That could not be removed.');
      },
    });
  }

  /** Still open, by the server's effective status. No date maths here. */
  protected isOpen(row: SavedJob): boolean {
    return row.jobStatusId === this.JOB_ACTIVE;
  }

  protected name(list: Lookup[], id: number | null | undefined): string {
    if (id === null || id === undefined) return '';

    return list.find((l) => l.id === id)?.name ?? '';
  }

  protected locationLabel(row: SavedJob): string {
    const city = this.name(this.cities(), row.cityId);
    const state = this.name(this.states(), row.stateId);

    return [city, state].filter(Boolean).join(', ') || row.branchName;
  }

  protected salaryLabel(row: SavedJob): string {
    if (row.salaryMin === null && row.salaryMax === null) {
      return row.isSalaryNegotiable ? 'Negotiable' : 'Not stated';
    }

    const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;

    return row.salaryMin !== null && row.salaryMax !== null
      ? `${fmt(row.salaryMin)} – ${fmt(row.salaryMax)}`
      : fmt((row.salaryMin ?? row.salaryMax) as number);
  }
}
