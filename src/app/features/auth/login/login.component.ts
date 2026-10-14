import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { APPLICATION_STAGES, UiAuthShellComponent, UiPasswordFieldComponent, UiRollComponent } from 'jp-shared/ui';
import { AppAccessService, AuthService, MenuService, ReturnUrlService, ToastService } from 'jp-shared/core';
import { applyServerErrors, clearServerError, fieldError, revealErrors } from 'jp-shared/models';

/**
 * Sign in.
 *
 * One identifier field, not two: the server decides whether it is an email or
 * a mobile by looking for an '@', and a single field means the response cannot
 * differ by which was supplied.
 *
 * There is deliberately NO minimum-length rule on the password here. Rejecting
 * a short password before anything is verified returns in microseconds and
 * creates a second timing signal alongside the one the server's decoy
 * credential exists to close (PROJECT_MEMORY 2.32).
 */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, UiAuthShellComponent, UiPasswordFieldComponent, UiRollComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly menu = inject(MenuService);
  private readonly access = inject(AppAccessService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly returnUrls = inject(ReturnUrlService);

  /**
   * 🔴 CAPTURED ON CONSTRUCTION, NOT READ AT SUBMIT TIME (7B-0).
   *
   * By the time the sign-in succeeds the app may have navigated — and on the
   * register -> "sign in to continue" path this screen is reached WITHOUT the
   * parameter, because the destination was captured a screen earlier. Reading
   * the URL at submit time would find nothing there and land on the dashboard.
   *
   * ⚠️ `capture` refuses anything that is not an app-relative path, so a
   * crafted ?returnUrl=https://evil.example stores nothing and this signs in
   * exactly as it did before. It is not an error and says nothing to the
   * visitor — a message naming the rule helps only whoever was probing it.
   */
  private readonly captured = this.returnUrls.capture(
    this.route.snapshot.queryParamMap.get('returnUrl'),
  );


  /**
   * True when this visit has somewhere to go afterwards.
   *
   * ⚠️ USED, not merely captured. Three things send somebody to this screen
   * with a destination already in mind — the auth guard, the session-expiry
   * interceptor, and the public site's Apply button — and saying so is the
   * difference between a funnel and a detour.
   *
   * 🔒 It is a BOOLEAN, never the path itself. Rendering the destination
   * would put an attacker-supplied string on the page: refused values never
   * reach here, but "the validator stopped it" is a poor reason to put
   * somebody else's text in our markup when a yes/no does the job.
   */
  protected readonly continuing = this.captured !== null;

  /** Drawn on the panel beside the form — the same roll the app itself uses. */
  protected readonly pipeline = APPLICATION_STAGES;

  /** Set when someone signs in here with another app's account. */
  protected readonly wrongApp = this.access.notice;

  protected readonly submitting = signal(false);

  /** Sits above the submit button. Credentials failing is a form-level fact. */
  protected readonly formError = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    loginId: ['', [Validators.required, Validators.maxLength(150)]],
    password: ['', [Validators.required]],
  });

  protected readonly loginIdError = computed(() => this.errorFor('loginId'));
  protected readonly passwordError = computed(() => this.errorFor('password'));

  /**
   * Recomputed on every status change so the computed signals above actually
   * re-evaluate — reactive forms are not signal-based, so the version counter
   * is what bridges them.
   */
  private readonly formVersion = signal(0);

  constructor() {
    this.form.statusChanges.subscribe(() => this.formVersion.update((n) => n + 1));
    this.form.valueChanges.subscribe(() => this.formVersion.update((n) => n + 1));
  }

  protected submit(): void {
    if (this.submitting()) {
      return;
    }

    this.formError.set(null);

    if (this.form.invalid) {
      revealErrors(this.form);
      this.formVersion.update((n) => n + 1);
      return;
    }

    this.submitting.set(true);

    this.auth.login(this.form.getRawValue()).subscribe({
      next: () => {
        // The menu belongs to whoever just signed in; anything cached belongs
        // to the last person who used this browser.
        this.menu.clear();
        this.submitting.set(false);

        /*
          The credentials were right — but were they right FOR THIS APP?

          All three apps authenticate against the same SSO API, so a school
          owner can sign in here perfectly successfully. enforce() checks the
          token's utype claim, and when it does not match it signs them out
          again and publishes a notice naming where they should go. Navigating
          anyway would drop them in a shell with an empty sidebar.
        */
        if (!this.access.enforce()) {
          return;
        }

        /*
          🔴 WHERE WERE THEY HEADED? (7B-0)

          Three things send somebody here with a destination already in mind:
          the auth guard (a bookmarked page behind a login), the session-expiry
          interceptor (halfway through something), and the public website's
          Apply button. All three put it in ?returnUrl=, all three were ignored
          until now — the guard's own comment claimed otherwise.

          🔒 ReturnUrlService validates it as an app-relative path and refuses
          anything that could leave this origin. An absolute URL is dropped and
          this lands on the home route, which is what it did before.
        */
        const pending = this.returnUrls.consume();

        void this.router.navigateByUrl(pending ?? this.auth.homeRoute());
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.handleFailure(error);
      },
    });
  }

  protected onFieldInput(name: 'loginId' | 'password'): void {
    clearServerError(this.form.get(name));
    this.formError.set(null);
  }

  private errorFor(name: string): string | null {
    // Read the version so the computed re-runs when the form changes.
    this.formVersion();

    return fieldError(this.form.get(name), {
      required: name === 'loginId' ? 'Enter your email or mobile number.' : 'Enter your password.',
    });
  }

  /**
   * A rejected sign-in is a form-level error, not a toast. The user is looking
   * at the form; putting the answer somewhere else makes them hunt for it.
   * Only a failure that is not about this form — no network, server down —
   * earns a toast.
   */
  private handleFailure(error: unknown): void {
    const response = (error as { error?: { message?: string; code?: string; errors?: null } })?.error;
    const status = (error as { status?: number })?.status ?? 0;

    if (status === 0) {
      this.toast.error("Couldn't reach the server. Check your connection and try again.");
      return;
    }

    if (status >= 500) {
      this.toast.error('Something went wrong at our end. Try again in a moment.');
      return;
    }

    if (status === 429) {
      this.formError.set('Too many attempts. Wait a minute, then try again.');
      return;
    }

    const attached = applyServerErrors(this.form, (response ?? null) as never);

    this.formError.set(attached ?? response?.message ?? 'That email or password is not correct.');
    this.formVersion.update((n) => n + 1);
  }
}
