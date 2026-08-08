import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { UiAuthShellComponent } from 'jp-shared/ui';
import { AuthService, ToastService } from 'jp-shared/core';
import { clearServerError, fieldError, revealErrors } from 'jp-shared/models';

/**
 * Start a password reset.
 *
 * ⚠️ THE CONFIRMATION IS DELIBERATELY VAGUE, AND MUST STAY THAT WAY.
 *
 * The server answers identically whether the address has an account or not,
 * and takes the same time doing it, so that this endpoint cannot be used to
 * discover who has an account here (PROJECT_MEMORY 2.32). A client that said
 * "we've sent it" for a real address and "no account found" for an unknown one
 * would hand that back in a single request.
 *
 * So the confirmation says "if that address has an account". It reads slightly
 * hedged on purpose; that hedge is the whole protection.
 */
@Component({
  selector: 'app-forgot-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, UiAuthShellComponent],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss',
})
export class ForgotPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly submitting = signal(false);
  protected readonly sent = signal(false);
  protected readonly sentTo = signal('');

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(150)]],
  });

  private readonly formVersion = signal(0);

  constructor() {
    this.form.statusChanges.subscribe(() => this.formVersion.update((n) => n + 1));
  }

  protected readonly emailError = computed(() => {
    this.formVersion();

    return fieldError(this.form.get('email'), {
      required: 'Enter the email on your account.',
    });
  });

  protected submit(): void {
    if (this.submitting()) {
      return;
    }

    if (this.form.invalid) {
      revealErrors(this.form);
      this.formVersion.update((n) => n + 1);
      return;
    }

    const email = this.form.getRawValue().email.trim().toLowerCase();

    this.submitting.set(true);

    this.auth.forgotPassword({ email }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.sentTo.set(email);
        this.sent.set(true);
      },
      error: (error: unknown) => {
        this.submitting.set(false);

        const status = (error as { status?: number })?.status ?? 0;

        if (status === 429) {
          this.toast.warning('You have asked for a few of these. Try again in an hour.');
          return;
        }

        if (status === 0 || status >= 500) {
          this.toast.error("Couldn't reach the server. Check your connection and try again.");
          return;
        }

        // Anything else is a validation failure on the address itself; there
        // is no branch here that could reveal whether the account exists.
        this.form.controls.email.setErrors({ server: 'That email address is not valid.' });
        this.formVersion.update((n) => n + 1);
      },
    });
  }

  protected onInput(): void {
    clearServerError(this.form.get('email'));
  }

  protected sendAgain(): void {
    this.sent.set(false);
  }
}
