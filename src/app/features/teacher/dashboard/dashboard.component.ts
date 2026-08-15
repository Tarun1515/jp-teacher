import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { UiBadgeComponent, UiButtonComponent, UiEmptyStateComponent } from 'jp-shared/ui';

import { DashboardService, TeacherDashboard } from '../../../core/dashboard.service';
import { ProfileSection } from '../../../core/profile-completion';
import { TeacherProfile, TeacherService } from '../../../core/teacher.service';
import { ProfileMeterComponent } from '../profile-meter/profile-meter.component';

/**
 * The teacher's dashboard.
 *
 * ----------------------------------------------------------------------------
 * 🔴 IT REUSES THE METER. IT DOES NOT HAVE ITS OWN.
 * ----------------------------------------------------------------------------
 * Completeness is one rule (2.54) with one display (2.60), and the display was
 * extracted from the profile screen in 3I precisely so this one could show it.
 * A second version would be a second rule: the day one of them prints "0%" or
 * names a different next step, one is wrong and nobody knows which.
 *
 * "Take me there" navigates to the profile section rather than scrolling, which
 * is the only difference between the two hosts and is why the component emits
 * the section instead of deciding what to do with it.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ THE MOTIVE FOR THIS SCREEN
 * ----------------------------------------------------------------------------
 * Everything downstream needs teachers with finished profiles: no profiles
 * means no applications, and no applications means the school side is a demo.
 * So this dashboard's job is to send somebody to the one thing worth doing
 * next — not to congratulate them, and not to show a wall of numbers about a
 * product that has not started yet.
 */
@Component({
  selector: 'app-teacher-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DatePipe,
    UiBadgeComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    ProfileMeterComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class TeacherDashboardComponent {
  private readonly dashboards = inject(DashboardService);
  private readonly teachers = inject(TeacherService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly data = signal<TeacherDashboard | null>(null);

  /**
   * The full profile, for the meter.
   *
   * ⚠️ The meter takes a TeacherProfile because that is what its rule reads —
   * subjects, experiences, locations, the resume path. Reshaping the dashboard
   * DTO into something meter-shaped would mean two definitions of "what counts
   * as done", which is exactly what one component exists to prevent.
   */
  protected readonly profile = signal<TeacherProfile | null>(null);

  /** "4 years 2 months", from the server's number — never computed here (2.54). */
  protected readonly experienceLabel = computed(() => {
    const months = this.data()?.totalExperienceMonths ?? 0;

    if (months <= 0) return null;

    const years = Math.floor(months / 12);
    const rest = months % 12;

    if (years === 0) return `${rest} month${rest === 1 ? '' : 's'}`;
    if (rest === 0) return `${years} year${years === 1 ? '' : 's'}`;

    return `${years}y ${rest}m`;
  });

  protected readonly planLine = computed(() => {
    const plan = this.data()?.plan;

    if (!plan?.hasSubscription) return 'No plan on file';
    if (!plan.isActive) return `${plan.planName ?? 'Your plan'} — not active`;

    return plan.planName ?? 'Your plan';
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);

    this.dashboards.getTeacher().subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.data.set(null);
        this.loadFailed.set(true);
        this.loading.set(false);
      },
    });

    // The meter's rule reads the whole profile. Out of band from the dashboard
    // call so a slow profile does not hold the tiles back — and a failure here
    // hides the meter rather than the page.
    this.teachers.getProfile().subscribe({
      next: (profile) => this.profile.set(profile),
      error: () => this.profile.set(null),
    });
  }

  /** The meter emits a section; here that means going to the profile screen. */
  protected goToProfile(section: ProfileSection): void {
    void this.router.navigate(['/profile'], { fragment: `section-${section}` });
  }

  protected readonly skeletonTiles = [0, 1, 2];
}
