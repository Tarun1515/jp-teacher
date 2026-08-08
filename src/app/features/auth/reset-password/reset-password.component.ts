import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { UiAuthShellComponent, UiPasswordFieldComponent } from 'jp-shared/ui';
import { AuthService, ToastService } from 'jp-shared/core';
import { fieldError, revealErrors } from 'jp-shared/models';

/**
 * Finish a password reset, or set a first password from an invitation.
 *
 * One component for both because the shape is identical — a single-use token
 * from a link, plus a new password — and the only differences are the endpoint
 * and the words. Two near-identical components would drift.
 */
@Component({
  selector: 'app-reset-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, UiAuthShellComponent, UiPasswordFieldComponent],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
})
export class ResetPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** `invite` when the route is /auth/accept-invite. */
  protected readonly mode = signal<'reset' | 'invite'>(
    this.route.snapshot.data['mode'] === 'invite' ? 'invite' : 'reset',
  );

  protected readonly token = signal(this.route.snapshot.queryParamMap.get('token') ?? '');

  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
    confirm: ['', [Validators.required]],
  });

  private readonly formVersion = signal(0);

  constructor() {
    this.form.statusChanges.subscribe(() => this.formVersion.update((n) => n + 1));
    this.form.valueChanges.subscribe(() => this.formVersion.update((n) => n + 1));
  }

  protected readonly isInvite = computed(() => this.mode() === 'invite');

  protected readonly title = computed(() =>
    this.isInvite() ? 'Set your password' : 'Choose a new password',
  );

  protected readonly subtitle = computed(() =>
    this.isInvite()
      ? 'You have been invited to a school team. Choose a password to finish setting up.'
      : 'You will be signed out on your other devices.',
  );

  protected readonly submitLabel = computed(() =>
    this.isInvite() ? 'Set password' : 'Save password',
  );

  protected readonly passwordError = computed(() => {
    this.formVersion();

    return fieldError(this.form.get('password'), {
      required: 'Choose a password.',
      minlength: 'Password needs at least 8 characters.',
    });
  });

  protected readonly confirmError = computed(() => {
    this.formVersion();

    const control = this.form.get('confirm');

    if (!control?.touched) {
      return null;
    }

    if (control.hasError('required')) {
      return 'Type the password again.';
    }

    const { password, confirm } = this.form.getRawValue();

    return confirm && password !== confirm ? 'The two passwords do not match.' : null;
  });

  protected submit(): void {
    if (this.submitting()) {
      return;
    }

    this.formError.set(null);

    if (this.form.invalid || this.confirmError()) {
      revealErrors(this.form);
      this.formVersion.update((n) => n + 1);
      return;
    }

    if (!this.token()) {
      this.formError.set(
        'This link is missing its code. Open the link from your email again, or ask for a new one.',
      );
      return;
    }

    const password = this.form.getRawValue().password;

    this.submitting.set(true);

    const request = this.isInvite()
      ? this.auth.setPasswordFromInvite({ token: this.token(), password })
      : this.auth.resetPassword({ token: this.token(), newPassword: password });

    request.subscribe({
      next: () => {
        this.submitting.set(false);

        // The action keeps its name: "Set password" produces "Password set".
        this.toast.success(
          this.isInvite()
            ? 'Password set. Sign in to get started.'
            : 'Password saved. Sign in with your new password.',
        );

        void this.router.navigate(['/auth/login']);
      },
      error: (error: unknown) => {
        this.submitting.set(false);

        const status = (error as { status?: number })?.status ?? 0;

        if (status === 0 || status >= 500) {
          this.toast.error("Couldn't reach the server. Check your connection and try again.");
          return;
        }

        const code = (error as { error?: { code?: string } })?.error?.code;

        this.formError.set(
          code === 'TOKEN_INVALID'
            ? this.isInvite()
              ? 'This invitation has already been used or has expired. Ask your school to send a new one.'
              : 'This reset link has already been used or has expired. Ask for a new one.'
            : ((error as { error?: { message?: string } })?.error?.message ??
              'We could not set that password. Try again.'),
        );
      },
    });
  }
}
