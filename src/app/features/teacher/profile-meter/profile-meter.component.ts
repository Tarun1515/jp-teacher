import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { UiButtonComponent } from 'jp-shared/ui';

import {
  NextStep,
  NO_RESUME_CAP,
  ProfileSection,
  isHeldByResumeCap,
  nextStep,
} from '../../../core/profile-completion';
import { TeacherProfile } from '../../../core/teacher.service';

/**
 * Profile completeness — progress and one next step, never a verdict.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THERE IS EXACTLY ONE OF THESE, AND THAT IS THE POINT
 * ----------------------------------------------------------------------------
 * Extracted from the profile screen in 3I so the dashboard could show the same
 * thing. The alternative was a second completeness display, and a second
 * display is a second rule: the day one of them prints "0%" or names a
 * different next step, one of them is wrong and nobody knows which.
 *
 * The rule it carries (2.54, 2.60):
 *
 *   THE NUMBER IS THE SERVER'S. USP_RecalculateTeacherProfile owns it and
 *     rewrites it on every change. Nothing here recomputes it.
 *
 *   AT 0% THE PERCENTAGE IS NOT SHOWN. Telling somebody they have achieved
 *     nothing before they have started is where people close the tab. They get
 *     an invitation and one thing to do.
 *
 *   ONE SUGGESTION, ORDERED BY VALUE PER EFFORT — not by points. Subjects (20,
 *     two taps, and nothing finds you without them) lead the resume (25, and a
 *     file somebody has to go and find).
 *
 *   THE 75% CAP IS EXPLAINED WHERE IT BITES. A bar that stops with no reason
 *     reads as broken, and this one genuinely stops.
 */
@Component({
  selector: 'app-profile-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonComponent],
  templateUrl: './profile-meter.component.html',
  styleUrl: './profile-meter.component.scss',
})
export class ProfileMeterComponent {
  readonly profile = input<TeacherProfile | null>(null);

  /**
   * What the action button says. The two hosts want different words for the
   * same thing: the profile screen scrolls, the dashboard navigates.
   */
  readonly actionLabel = input('Take me there');

  /** Which section to go to. The host decides what "go" means. */
  readonly go = output<ProfileSection>();

  protected readonly percent = computed(() => this.profile()?.profileCompletionPercent ?? 0);

  protected readonly next = computed<NextStep | null>(() => nextStep(this.profile()));

  protected readonly heldByResumeCap = computed(() => isHeldByResumeCap(this.profile()));

  protected readonly resumeCap = NO_RESUME_CAP;

  protected readonly hasResume = computed(() => !!this.profile()?.resumePath);

  /**
   * The line above the bar.
   *
   * 🔴 Never "0% complete" — see the class comment. At zero this is an
   * invitation; in the middle it is progress; at the end it is a fact worth
   * being pleased about.
   */
  protected readonly headline = computed(() => {
    const percent = this.percent();

    if (percent === 0) return 'Let’s get you found by schools';
    if (percent >= 100) return 'Your profile is complete';
    if (this.heldByResumeCap()) return 'One thing left';

    return 'Your profile so far';
  });
}
