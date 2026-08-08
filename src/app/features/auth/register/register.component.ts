import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  AppAccessService,
  AuthService,
  MenuService,
  ToastService,
  applyServerErrors,
  clearServerError,
  fieldError,
  revealErrors,
} from '@tarun1515/jp-shared';
import { APPLICATION_STAGES, UiAuthShellComponent, UiPasswordFieldComponent, UiRollComponent } from '@tarun1515/jp-shared';

/**
 * Create a teacher account.
 *
 * ----------------------------------------------------------------------------
 * NO USER-TYPE TOGGLE
 * ----------------------------------------------------------------------------
 * The old single portal had one signup with an "I am a school / I am a teacher"
 * radio pair. With separate apps there is nothing to choose: this app can only
 * create one kind of account, so the choice was removed rather than defaulted.
 *
 * That is a better form than the toggle was. Every label, every helper line and
 * the consequence copy below now address one audience directly instead of
 * switching under the reader.
 */
@Component({
  selector: 'app-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    UiAuthShellComponent,
    UiPasswordFieldComponent,
    UiRollComponent,
  ],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly menu = inject(MenuService);
  private readonly access = inject(AppAccessService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly pipeline = APPLICATION_STAGES;

  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(150)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(150)]],
    mobile: ['', [Validators.pattern(/^[6-9]\d{9}$/)]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
  });

  private readonly formVersion = signal(0);

  constructor() {
    this.form.statusChanges.subscribe(() => this.formVersion.update((n) => n + 1));
    this.form.valueChanges.subscribe(() => this.formVersion.update((n) => n + 1));
  }

  protected readonly nameError = computed(() =>
    this.errorFor('name', { required: 'Enter your name.' }),
  );

  protected readonly emailError = computed(() =>
    this.errorFor('email', { required: 'Enter your email address.' }),
  );

  protected readonly mobileError = computed(() =>
    this.errorFor('mobile', { pattern: 'Enter a 10-digit mobile number starting 6 to 9.' }),
  );

  protected readonly passwordError = computed(() =>
    this.errorFor('password', {
      required: 'Choose a password.',
      minlength: 'Password needs at least 8 characters.',
    }),
  );

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

    const { email, mobile, password } = this.form.getRawValue();
    const payload = { email: email.trim().toLowerCase(), mobile: mobile || null, password };

    this.submitting.set(true);

    this.auth.registerTeacher(payload).subscribe({
      next: () => {
        // Registration does not return a session. Signing in immediately is
        // what makes "create account" land somewhere useful rather than on a
        // second form asking for the password just typed.
        this.auth.login({ loginId: payload.email, password }).subscribe({
          next: () => {
            this.menu.clear();
            this.submitting.set(false);

            if (!this.access.enforce()) {
              return;
            }

            void this.router.navigate([this.auth.homeRoute()]);
          },
          error: () => {
            // The account exists; only the convenience sign-in failed. Say
            // exactly that rather than implying the registration did not work.
            this.submitting.set(false);
            this.toast.success('Account created. Sign in to continue.');
            void this.router.navigate(['/auth/login']);
          },
        });
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.handleFailure(error);
      },
    });
  }

  protected onFieldInput(name: string): void {
    clearServerError(this.form.get(name));
    this.formError.set(null);
  }

  private errorFor(name: string, labels: Record<string, string> = {}): string | null {
    this.formVersion();

    return fieldError(this.form.get(name), labels);
  }

  private handleFailure(error: unknown): void {
    const status = (error as { status?: number })?.status ?? 0;
    const response = (error as { error?: { message?: string; code?: string } })?.error;

    if (status === 0) {
      this.toast.error("Couldn't reach the server. Check your connection and try again.");
      return;
    }

    if (status >= 500) {
      this.toast.error('Something went wrong at our end. Try again in a moment.');
      return;
    }

    // A duplicate belongs on the field it duplicates, with the way out.
    if (response?.code === 'DUPLICATE_EMAIL') {
      this.form.controls.email.setErrors({
        server: 'An account already exists with this email. Sign in instead.',
      });
      this.form.controls.email.markAsTouched();
      this.formVersion.update((n) => n + 1);
      return;
    }

    if (response?.code === 'DUPLICATE_MOBILE') {
      this.form.controls.mobile.setErrors({
        server: 'An account already exists with this mobile number.',
      });
      this.form.controls.mobile.markAsTouched();
      this.formVersion.update((n) => n + 1);
      return;
    }

    this.formError.set(
      applyServerErrors(this.form, (response ?? null) as never) ??
        'We could not create the account. Check the details and try again.',
    );
    this.formVersion.update((n) => n + 1);
  }
}
