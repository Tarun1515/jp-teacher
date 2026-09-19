import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MasterService } from 'jp-shared/core';
import { Lookup, MASTER_KEYS } from 'jp-shared/models';
import { UiBadgeComponent, UiEmptyStateComponent } from 'jp-shared/ui';

import {
  APPLICATION_STATUS,
  JobSearchService,
  MyApplicationDetail,
} from '../../../../core/job-search.service';

/**
 * One of my applications.
 *
 * ----------------------------------------------------------------------------
 * 🔴 ANOTHER TEACHER'S APPLICATION IS A 404, AND SO IS ONE THAT NEVER EXISTED
 * ----------------------------------------------------------------------------
 * The procedure resolves the teacher from the token and matches on it, so an
 * id belonging to somebody else returns nothing at all. The screen renders that
 * as "not found" — never as "not yours", which would confirm it exists (2.6).
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE HISTORY IS THE TEACHER'S VERSION OF IT
 * ----------------------------------------------------------------------------
 * Each step carries `TeacherFacingName`, so the timeline reads "Seen by the
 * school" and "Not selected". Three things the SCHOOL sees are not in this
 * response at all — the actor who moved it, the school's remarks, and the
 * rejection reason (017). They are absent rather than hidden: there is nothing
 * here for a devtools inspector to find.
 *
 * ⚠️ NO WITHDRAW CONTROL, and not a disabled one either (G28). A half-built
 * withdraw would revoke a school's contact access through a path nobody
 * designed.
 */
@Component({
  selector: 'app-my-application',
  standalone: true,
  imports: [DatePipe, RouterLink, UiBadgeComponent, UiEmptyStateComponent],
  templateUrl: './my-application.component.html',
  styleUrl: './my-application.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyApplicationComponent {
  private readonly jobs = inject(JobSearchService);
  private readonly masters = inject(MasterService);
  private readonly route = inject(ActivatedRoute);

  protected readonly data = signal<MyApplicationDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);

  protected readonly subjects = signal<Lookup[]>([]);
  protected readonly designations = signal<Lookup[]>([]);
  protected readonly employmentTypes = signal<Lookup[]>([]);
  protected readonly cities = signal<Lookup[]>([]);
  protected readonly states = signal<Lookup[]>([]);

  constructor() {
    this.route.paramMap.subscribe((params) => {
      const id = Number(params.get('applicationId'));

      if (!Number.isFinite(id) || id <= 0) {
        this.notFound.set(true);
        this.loading.set(false);

        return;
      }

      this.load(id);
    });

    this.masters.get(MASTER_KEYS.subject).subscribe((v) => this.subjects.set(v));
    this.masters.get(MASTER_KEYS.designation).subscribe((v) => this.designations.set(v));
    this.masters.get(MASTER_KEYS.employmentType).subscribe((v) => this.employmentTypes.set(v));
    this.masters.get(MASTER_KEYS.city).subscribe((v) => this.cities.set(v));
    this.masters.get(MASTER_KEYS.state).subscribe((v) => this.states.set(v));
  }

  protected load(applicationId: number): void {
    this.loading.set(true);
    this.notFound.set(false);

    this.jobs.myApplication(applicationId).subscribe({
      next: (detail) => {
        this.data.set(detail);
        this.loading.set(false);
      },
      error: () => {
        this.data.set(null);
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }

  protected tone(statusId: number): 'success' | 'warning' | 'neutral' | 'primary' {
    switch (statusId) {
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

  protected name(list: Lookup[], id: number | null | undefined): string {
    if (id === null || id === undefined) return '—';

    return list.find((l) => l.id === id)?.name ?? '—';
  }

  protected locationLabel(a: MyApplicationDetail): string {
    const city = this.name(this.cities(), a.branchCityId);
    const state = this.name(this.states(), a.branchStateId);

    return [city, state].filter((x) => x && x !== '—').join(', ') || a.branchName;
  }

  protected salaryLabel(a: MyApplicationDetail): string {
    if (a.salaryMin === null && a.salaryMax === null) {
      return a.isSalaryNegotiable ? 'Negotiable' : 'Not stated';
    }

    const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;

    const range =
      a.salaryMin !== null && a.salaryMax !== null
        ? `${fmt(a.salaryMin)} – ${fmt(a.salaryMax)}`
        : fmt((a.salaryMin ?? a.salaryMax) as number);

    return a.isSalaryNegotiable ? `${range} · negotiable` : range;
  }
}
