import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { UiAuthShellComponent, UiOtpInputComponent } from 'jp-shared/ui';
import { AuthService, ToastService } from 'jp-shared/core';
import { OTP_CHANNEL } from 'jp-shared/models';

const RESEND_SECONDS = 45;

/**
 * Verify an emailed code.
 *
 * Two details do most of the work here:
 *
 *   The code auto-submits once six digits are in. Asking someone to type six
 *   digits and then find a button is a step that exists only because the form
 *   was built before it was used.
 *
 *   The resend is on a visible countdown rather than disabled with no
 *   explanation. "Send again in 0:42" tells the user the button will come
 *   back; a greyed-out button tells them nothing and they reload the page.
 */
@Component({
  selector: 'app-verify-otp',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, UiAuthShellComponent, UiOtpInputComponent],
  templateUrl: './verify-otp.component.html',
  styleUrl: './verify-otp.component.scss',
})
export class VerifyOtpComponent implements OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);
  protected readonly resending = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly secondsLeft = signal(RESEND_SECONDS);

  protected readonly email = computed(() => this.auth.currentUser()?.userUid ?? '');

  protected readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(6)]],
  });

  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.startCountdown();
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected readonly countdown = computed(() => {
    const total = this.secondsLeft();
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  });

  protected readonly canResend = computed(() => this.secondsLeft() === 0 && !this.resending());

  /** Fired by the OTP component the moment the sixth digit lands. */
  protected onCompleted(): void {
    this.submit();
  }

  protected submit(): void {
    if (this.submitting() || this.form.invalid) {
      return;
    }

    this.formError.set(null);
    this.submitting.set(true);

    this.auth
      .verifyOtp({ channelId: OTP_CHANNEL.email, code: this.form.getRawValue().code })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.toast.success('Email verified.');
          void this.router.navigate([this.auth.homeRoute()]);
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
            code === 'OTP_EXPIRED'
              ? 'That code has expired. Send a new one.'
              : "That code isn't right. Check the digits and try again.",
          );

          this.form.controls.code.setValue('');
        },
      });
  }

  protected resend(): void {
    if (!this.canResend()) {
      return;
    }

    this.resending.set(true);
    this.formError.set(null);

    this.auth.sendOtp({ channelId: OTP_CHANNEL.email }).subscribe({
      next: () => {
        this.resending.set(false);
        this.toast.success('New code sent.');
        this.startCountdown();
      },
      error: (error: unknown) => {
        this.resending.set(false);

        const status = (error as { status?: number })?.status ?? 0;

        if (status === 429) {
          this.toast.warning('That is a few codes now. Try again in ten minutes.');
          return;
        }

        this.toast.error("Couldn't send a new code. Try again in a moment.");
      },
    });
  }

  private startCountdown(): void {
    clearInterval(this.timer);
    this.secondsLeft.set(RESEND_SECONDS);

    this.timer = setInterval(() => {
      this.secondsLeft.update((value) => {
        if (value <= 1) {
          clearInterval(this.timer);
          return 0;
        }

        return value - 1;
      });
    }, 1000);
  }
}
