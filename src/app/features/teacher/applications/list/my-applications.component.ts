import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ToastService } from 'jp-shared/core';
import { UiBadgeComponent, UiEmptyStateComponent } from 'jp-shared/ui';

import {
  APPLICATION_STATUS,
  JobSearchService,
  MyApplicationListItem,
} from '../../../../core/job-search.service';

/**
 * My applications.
 *
 * ----------------------------------------------------------------------------
 * 🔴 EVERY STATUS WORD HERE IS THE TEACHER'S, AND IT COMES FROM THE SERVER
 * ----------------------------------------------------------------------------
 * `statusName` is `m_app_application_status.TeacherFacingName`, not `Name`. A
 * school marks somebody "Rejected"; the teacher is shown "Not selected", and
 * "Viewed" reads "Seen by the school".
 *
 * ⚠️ THE TWO VOCABULARIES NEVER MEET. The school's wording is not sent to this
 * app at all, and neither is the school's private rejection note — that column
 * is not in the teacher's procedures (017). There is nothing here to
 * accidentally render.
 *
 * ⚠️ AND NO MASTER IS READ ON THIS SCREEN. The obvious way to build a status
 * filter would be `/api/masters/application-status`, but that key returns the
 * SCHOOL's names — a filter saying "Rejected" above a row saying "Not selected"
 * would be the product contradicting itself. Every row carries its own word,
 * so the tabs are built from the rows themselves and say exactly what the rows
 * say.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ THERE IS NO WITHDRAW, AND ITS ABSENCE IS DELIBERATE (G28)
 * ----------------------------------------------------------------------------
 * A teacher cannot take an application back in this phase. A half-built
 * withdraw that soft-deleted the row would revoke a school's contact access
 * through a path nobody designed — `fn_TeacherContactUnlocked` reads live
 * applications — so it waits for a real design rather than an improvised
 * button. The screen does not pretend otherwise: no disabled control sits here
 * implying one is coming.
 */
@Component({
  selector: 'app-my-applications',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink, UiBadgeComponent, UiEmptyStateComponent],
  templateUrl: './my-applications.component.html',
  styleUrl: './my-applications.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyApplicationsComponent {
  private readonly jobs = inject(JobSearchService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly rows = signal<MyApplicationListItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  /** Null means everything. */
  protected readonly statusId = signal<number | null>(null);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);

    /*
      ⚠️ Always the FULL list. The endpoint takes a statusId and the filter
      below is applied here instead, because the tabs are built from these rows
      — filtering on the server would empty the list the tabs are made of, and
      the tab somebody was standing on would vanish under them.

      A teacher has tens of applications, not thousands. When that stops being
      true, the tabs need their own count endpoint and the filter moves to the
      server with it.
    */
    this.jobs.myApplications().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.rows.set([]);
        this.loading.set(false);
        this.failed.set(true);
        this.toast.error('Your applications could not be loaded.');
      },
    });
  }

  /**
   * The tabs, built from the rows.
   *
   * 🔴 Each tab's label is the TEACHER-FACING name carried by the rows it
   * holds, so the tab and the rows under it always say the same thing. Ordered
   * by status id, which is the master's own progression (2.47 — ids are
   * contract).
   */
  protected readonly tabs = computed(() => {
    const seen = new Map<number, { id: number; label: string; count: number }>();

    for (const row of this.rows()) {
      const existing = seen.get(row.applicationStatusId);

      if (existing) {
        existing.count += 1;
      } else {
        seen.set(row.applicationStatusId, {
          id: row.applicationStatusId,
          label: row.statusName,
          count: 1,
        });
      }
    }

    return [...seen.values()].sort((a, b) => a.id - b.id);
  });

  protected readonly filtered = computed(() => {
    const id = this.statusId();

    return id === null ? this.rows() : this.rows().filter((r) => r.applicationStatusId === id);
  });

  protected setFilter(id: number | null): void {
    this.statusId.set(id);
  }

  // ---- display -------------------------------------------------------------

  protected tone(row: MyApplicationListItem): 'success' | 'warning' | 'neutral' | 'primary' {
    switch (row.applicationStatusId) {
      case APPLICATION_STATUS.selected:
        return 'success';
      case APPLICATION_STATUS.rejected:
        return 'neutral';
      case APPLICATION_STATUS.shortlisted:
      case APPLICATION_STATUS.interview:
        return 'primary';
      default:
        return 'warning';
    }
  }

  /**
   * A closed application recedes as a whole, rather than being struck through.
   *
   * ⚠️ NO "attention" rule on this side. On the school's list the margin marks
   * rows waiting on THEM; nothing here is waiting on the teacher, so a red
   * margin would only be anxiety with no action attached to it.
   */
  protected rowState(row: MyApplicationListItem): string {
    return row.applicationStatusId === APPLICATION_STATUS.rejected ? 'row--muted' : '';
  }

  protected salaryLabel(row: MyApplicationListItem): string {
    if (row.salaryMin === null && row.salaryMax === null) {
      return row.isSalaryNegotiable ? 'Negotiable' : '—';
    }

    const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;

    return row.salaryMin !== null && row.salaryMax !== null
      ? `${fmt(row.salaryMin)} – ${fmt(row.salaryMax)}`
      : fmt((row.salaryMin ?? row.salaryMax) as number);
  }

  protected open(row: MyApplicationListItem): void {
    this.router.navigate(['/applications', row.applicationId]);
  }
}
