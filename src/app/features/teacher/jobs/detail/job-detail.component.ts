import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MasterService, ToastService } from 'jp-shared/core';
import { TeacherService } from '../../../../core/teacher.service';
import { Lookup, MASTER_KEYS } from 'jp-shared/models';
import { UiBadgeComponent, UiEmptyStateComponent } from 'jp-shared/ui';

import {
  JobForTeacher,
  JobSearchService,
  applyRefusalMessage,
} from '../../../../core/job-search.service';

/**
 * One posting, and the act of applying to it.
 *
 * ----------------------------------------------------------------------------
 * 🔒 APPLYING IS CONSENT (2.56, LOCKED). THE SCREEN SAYS SO BEFORE IT HAPPENS.
 * ----------------------------------------------------------------------------
 * This is consent path 1: the application is what opens this teacher's email
 * and mobile to THIS school, and to no other. It is also not undoable — there
 * is no withdraw in the product (a deliberate deferral, G28).
 *
 * Both facts are on screen next to the button, not in a tooltip and not after
 * the fact. Somebody handing over their phone number is entitled to know they
 * are doing it.
 *
 * ⚠️ NOTHING IS CHARGED HERE, and nothing may ever be. The consuming action is
 * the school's PUBLISH (2.64). There is no entitlement call on this page.
 *
 * ----------------------------------------------------------------------------
 * 🔴 TWO REFUSALS ARE RENDERED IN PLACE, NOT TOASTED
 * ----------------------------------------------------------------------------
 *   RESUME_REQUIRED  names the missing piece and links straight to the resume
 *                    section of the profile. "Not yet" language (2.62): this is
 *                    a fact about what is MISSING, not about who they are, so
 *                    the control stays and the reason sits beside it.
 *   JOB_EXPIRED      replaces the button entirely and states the closing date.
 *                    The answer will never change, so the control goes.
 *
 * Both are listed in the shared interceptor's COMPONENT_RENDERED_CODES, so a
 * person gets ONE message rather than a toast on top of the panel. Adding a
 * code there without rendering it is how a refusal becomes silence — the entry
 * and this component belong in the same commit.
 *
 * ⚠️ ALREADY_APPLIED IS A SUCCESS (HTTP 200). A double-tap, or the loser of a
 * genuinely parallel double-apply, resolves to the application that already
 * exists. Showing it as an error would send somebody to support over a working
 * application.
 */
@Component({
  selector: 'app-job-detail',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink, UiBadgeComponent, UiEmptyStateComponent],
  templateUrl: './job-detail.component.html',
  styleUrl: './job-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobDetailComponent {
  private readonly jobs = inject(JobSearchService);
  private readonly masters = inject(MasterService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly teachers = inject(TeacherService);
  private readonly router = inject(Router);

  protected readonly data = signal<JobForTeacher | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly busy = signal(false);

  protected readonly coverNote = signal('');

  /**
   * The refusal this page is showing, if any.
   *
   * 🔴 Held in state rather than flashed as a toast, because both codes it can
   * hold have a NEXT STEP — and a next step that disappears after four seconds
   * is not a next step.
   */
  protected readonly refusal = signal<string | null>(null);

  /** True when the route was /jobs/:jobUid/apply — the public funnel's landing. */
  protected readonly arrivedToApply = signal(false);

  /**
   * The teacher's own name, for the funnel's landing. Phase 7B.
   *
   * ---------------------------------------------------------------------------
   * 🔴 FETCHED ONLY ON THE FUNNEL LANDING, NEVER ON AN ORDINARY JOB PAGE
   * ---------------------------------------------------------------------------
   * Greeting by name costs one request to /teacher/profile, and a job page has
   * no other reason to make it — so it is made only when `arrivedToApply` is
   * true: once, for somebody who has just created an account and come through
   * four screens.
   *
   * ⚠️ The token cannot supply this. `CurrentUser` carries claims — ids, roles,
   * permissions, status — and deliberately no name; a display name in a JWT
   * goes stale the moment somebody corrects their spelling.
   *
   * ⚠️ EMPTY IS A VALID STATE and the template falls back to the unnamed
   * wording. A failed profile read must not cost the visitor the banner that
   * tells them where they are.
   *
   * 🔴 It is also what proves G43 end to end: this name crossed the signup
   * form, the request contract, the SSO account, the provisioning procedure's
   * @FullName and the column to get here. For six phases it was collected and
   * dropped in the browser, so there was nothing to greet with.
   */
  protected readonly greetingName = signal('');

  protected readonly subjects = signal<Lookup[]>([]);
  protected readonly designations = signal<Lookup[]>([]);
  protected readonly qualifications = signal<Lookup[]>([]);
  protected readonly employmentTypes = signal<Lookup[]>([]);
  protected readonly classLevels = signal<Lookup[]>([]);
  protected readonly cities = signal<Lookup[]>([]);
  protected readonly states = signal<Lookup[]>([]);

  constructor() {
    /*
      🔴 TWO ROUTE SHAPES REACH THIS COMPONENT (7B-0):

          /jobs/:jobId        an integer — every link inside this app
          /jobs/:jobUid/apply a uid     — the public website's Apply button

      The second exists because the public surface exposes no integer job id
      (2.47). Both load the same screen because it IS the same screen: the job,
      with the apply control beside it. A separate "apply page" would have been
      a second copy of this template that drifts from it.

      ⚠️ The uid branch is checked FIRST. Reading jobId first and falling back
      would mean Number(null) -> NaN on the uid route, which takes the
      not-found branch below — the funnel would land on "this posting has gone"
      for a job that is live.
    */
    this.route.paramMap.subscribe((params) => {
      const uid = params.get('jobUid');

      if (uid) {
        this.loadByUid(uid);

        return;
      }

      const id = Number(params.get('jobId'));

      if (!Number.isFinite(id) || id <= 0) {
        this.notFound.set(true);
        this.loading.set(false);

        return;
      }

      this.load(id);
    });

    /*
      Arriving through the funnel rather than from inside the app. Set from
      route data so the template can say which job they were applying for —
      somebody who has just created an account, verified a code and been
      redirected deserves to be told where they ended up and why.
    */
    this.arrivedToApply.set(this.route.snapshot.data['arrivedToApply'] === true);

    if (this.arrivedToApply()) {
      /*
        ⚠️ Errors swallowed deliberately: the greeting is a courtesy and the
        banner it decorates is the useful part. A toast about a failed profile
        read would be the first thing a brand-new account ever saw.
      */
      this.teachers.getProfile().subscribe({
        next: (profile) => this.greetingName.set((profile.fullName ?? '').trim()),
        error: () => this.greetingName.set(''),
      });
    }

    this.masters.get(MASTER_KEYS.subject).subscribe((v) => this.subjects.set(v));
    this.masters.get(MASTER_KEYS.designation).subscribe((v) => this.designations.set(v));
    this.masters.get(MASTER_KEYS.qualification).subscribe((v) => this.qualifications.set(v));
    this.masters.get(MASTER_KEYS.employmentType).subscribe((v) => this.employmentTypes.set(v));
    this.masters.get(MASTER_KEYS.classLevel).subscribe((v) => this.classLevels.set(v));
    this.masters.get(MASTER_KEYS.city).subscribe((v) => this.cities.set(v));
    this.masters.get(MASTER_KEYS.state).subscribe((v) => this.states.set(v));
  }

  /**
   * The funnel's entry point. Phase 7B-0.
   *
   * ⚠️ Identical handling to `load` below, deliberately — including the error
   * branch. A uid that names a draft, an expired job or nothing at all gets
   * the same "this posting has gone" a bad integer gets, because the server
   * gives the same 404 for all of them and this screen has no more to say.
   */
  protected loadByUid(jobUid: string): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.refusal.set(null);

    this.jobs.getByUid(jobUid).subscribe({
      next: (job) => {
        this.data.set(job);
        this.loading.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }

  protected load(jobId: number): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.refusal.set(null);

    this.jobs.get(jobId).subscribe({
      next: (job) => {
        this.data.set(job);
        this.loading.set(false);
      },
      error: () => {
        /*
          🔴 A CLOSED OR EXPIRED POSTING ANSWERS 404, and this page renders that
          as "this posting has gone" rather than as an error.

          It is the URL somebody bookmarks, or is sent a month later. A page
          that still drew an Apply button the server would refuse wastes the
          applicant's time and reads as a broken product.
        */
        this.data.set(null);
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }

  // ---- applying ------------------------------------------------------------

  protected apply(): void {
    const job = this.data();

    if (!job) return;

    this.busy.set(true);
    this.refusal.set(null);

    this.jobs.apply(job.jobId, this.coverNote().trim() || null).subscribe({
      next: (result) => {
        this.busy.set(false);

        /*
          ⚠️ BOTH OUTCOMES ARE SUCCESS. `created: false` with ALREADY_APPLIED is
          a double-tap resolving to the application they already have — saying
          so is better than silence, because they are about to wonder whether
          they applied twice.
        */
        this.toast.success(
          result.created
            ? 'Applied. The school can now see your profile and contact you.'
            : 'You had already applied to this job — nothing was sent twice.',
        );

        this.coverNote.set('');

        // Re-read: hasApplied flips, and the page's whole panel changes with it.
        this.load(job.jobId);
      },
      error: (err) => {
        this.busy.set(false);

        const code = err?.error?.code ?? null;

        if (code === 'RESUME_REQUIRED' || code === 'JOB_EXPIRED') {
          // Rendered in place — see the class header.
          this.refusal.set(code);

          // ⚠️ An expired job is no longer what this page is showing; re-read so
          // the posting itself stops claiming to be open.
          if (code === 'JOB_EXPIRED') this.load(job.jobId);

          return;
        }

        this.toast.error(applyRefusalMessage(code, 'That application could not be sent.'));
      },
    });
  }

  protected toggleSaved(): void {
    const job = this.data();

    if (!job) return;

    this.busy.set(true);

    this.jobs.toggleSaved(job.jobId).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.data.update((j) => (j ? { ...j, isSaved: result.isSaved } : j));
        this.toast.success(result.isSaved ? 'Saved.' : 'Removed from saved jobs.');
      },
      error: () => {
        this.busy.set(false);
        this.toast.error('That could not be saved.');
      },
    });
  }

  // ---- display -------------------------------------------------------------

  protected readonly resumeMissing = computed(() => this.refusal() === 'RESUME_REQUIRED');
  protected readonly expired = computed(() => this.refusal() === 'JOB_EXPIRED');

  protected name(list: Lookup[], id: number | null | undefined): string {
    if (id === null || id === undefined) return '—';

    return list.find((l) => l.id === id)?.name ?? '—';
  }

  protected names(list: Lookup[], ids: number[]): string {
    const found = ids.map((id) => list.find((l) => l.id === id)?.name).filter(Boolean);

    return found.length > 0 ? found.join(', ') : '—';
  }

  protected locationLabel(job: JobForTeacher): string {
    const city = this.name(this.cities(), job.cityId ?? job.branchCityId);
    const state = this.name(this.states(), job.stateId ?? job.branchStateId);

    return [city, state].filter((x) => x && x !== '—').join(', ') || job.branchName;
  }

  protected salaryLabel(job: JobForTeacher): string {
    if (job.salaryMin === null && job.salaryMax === null) {
      return job.isSalaryNegotiable ? 'Negotiable' : 'Not stated';
    }

    const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;

    const range =
      job.salaryMin !== null && job.salaryMax !== null
        ? `${fmt(job.salaryMin)} – ${fmt(job.salaryMax)}`
        : fmt((job.salaryMin ?? job.salaryMax) as number);

    return job.isSalaryNegotiable ? `${range} · negotiable` : range;
  }

  protected experienceLabel(job: JobForTeacher): string {
    const min = job.minExperienceMonths;
    const max = job.maxExperienceMonths;

    if (min === null && max === null) return 'Not stated';

    const years = (m: number) => (m % 12 === 0 ? `${m / 12} years` : `${m} months`);

    if (min !== null && max !== null) return `${years(min)} – ${years(max)}`;
    if (min !== null) return `${years(min)} or more`;

    return `up to ${years(max as number)}`;
  }

  /** "09:00:00" → "9:00 am". Times are stored as a TimeSpan, not a date. */
  protected timeLabel(value: string | null): string {
    if (!value) return '';

    const [h, m] = value.split(':').map(Number);

    if (!Number.isFinite(h)) return value;

    const suffix = h < 12 ? 'am' : 'pm';
    const hour = h % 12 === 0 ? 12 : h % 12;

    return `${hour}:${String(m ?? 0).padStart(2, '0')} ${suffix}`;
  }

  protected browse(): void {
    this.router.navigate(['/jobs']);
  }
}
