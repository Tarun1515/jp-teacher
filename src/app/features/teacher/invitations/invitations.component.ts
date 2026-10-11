import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ConfirmDialogService, ToastService } from 'jp-shared/core';
import { UiBadgeComponent, UiEmptyStateComponent } from 'jp-shared/ui';

import {
  INVITE_STATUS,
  InvitationService,
  MyInvitation,
} from '../../../core/invitation.service';

/**
 * 🔒 The teacher's invitations — and the second of two consent decisions.
 *
 * ----------------------------------------------------------------------------
 * 🔒 WHAT ACCEPTING DOES, SAID BEFORE THE CLICK
 * ----------------------------------------------------------------------------
 * 2.56 (LOCKED) gives a school exactly two ways to reach a teacher: the teacher
 * applied to one of its jobs, or the teacher ACCEPTED an invitation. This
 * button is one of those two. So the confirmation names the consequence in
 * plain words — the school will be able to see your email, mobile and resume —
 * because a permission somebody did not know they were granting is not a
 * permission they granted.
 *
 * ⚠️ And the screen does NOT dress accepting up as a reward. There is no
 * "unlocked!" state, no celebration, no badge. The teacher has agreed to be
 * contacted; that is a fact to state, not an achievement.
 *
 * ----------------------------------------------------------------------------
 * 🔴 VIEWING IS NOT ANSWERING
 * ----------------------------------------------------------------------------
 * Opening the list stamps the OPEN invitations as seen, which unlocks nothing
 * (027: status 2 is not the IsConsent row). It exists so a school can tell
 * "not read yet" from "read and thinking", which is honest information.
 *
 * ⚠️ Stamped on RENDER rather than on a button, for the same reason the
 * applicant detail stamps Viewed on open: a flag behind a button reports
 * whether somebody remembered to press it.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE WORDING IS THE TEACHER'S OWN
 * ----------------------------------------------------------------------------
 * Every row carries `inviteStatusName` from TeacherFacingName — "You passed on
 * this", not "Ignored". This component never fetches the invite-status master,
 * because that master holds the SCHOOL's vocabulary (5B's lesson).
 */
@Component({
  selector: 'app-invitations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, UiBadgeComponent, UiEmptyStateComponent],
  templateUrl: './invitations.component.html',
  styleUrl: './invitations.component.scss',
})
export class InvitationsComponent {
  private readonly invitations = inject(InvitationService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly rows = signal<MyInvitation[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly answering = signal<number | null>(null);

  /** The reply box, per invitation — optional, and the teacher's own words. */
  protected readonly remarks = signal('');
  protected readonly replyingTo = signal<number | null>(null);

  protected readonly open = computed(() => this.rows().filter((r) => r.isOpen));
  protected readonly answered = computed(() => this.rows().filter((r) => !r.isOpen));

  protected readonly STATUS = INVITE_STATUS;

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.invitations.list().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);

        /*
          🔴 STAMPED ON RENDER, not behind a button — and only the ones that are
          actually unseen. A school reading "not opened yet" needs that to mean
          it; a flag somebody has to press is a flag about their memory.

          ⚠️ Fire and forget. If the stamp fails the teacher loses nothing and
          must not be shown an error about a thing they did not ask for.
        */
        for (const row of rows.filter((r) => r.inviteStatusId === INVITE_STATUS.sent)) {
          this.invitations.markViewed(row.inviteId).subscribe({ error: () => {} });
        }
      },
      error: () => {
        /*
          🔴 A FAILED LOAD IS NOT AN EMPTY INBOX. "No school has invited you" is
          a sentence about this teacher's standing in the market, and showing it
          when the truth is a dropped request is unkind as well as wrong.
        */
        this.rows.set([]);
        this.loading.set(false);
        this.failed.set(true);
      },
    });
  }

  protected toggleReply(inviteId: number): void {
    this.remarks.set('');
    this.replyingTo.set(this.replyingTo() === inviteId ? null : inviteId);
  }

  /**
   * 🔒 Accepting. The consequence is named in the confirmation.
   */
  protected async accept(row: MyInvitation): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Let ${row.schoolName} contact you?`,

      /*
        🔒 THE SENTENCE THAT MAKES THIS CONSENT.

        It names what the school gets, in the three words a teacher cares about,
        and it says the one thing that is easy to assume wrongly: this is about
        THIS school, not about being listed publicly.
      */
      message:
        `${row.schoolName} will be able to see your email address, your phone number and your resume. `
        + 'No other school gets them, and you can still decide not to apply. '
        + 'Accepting does not commit you to anything.',
      /*
        ⚠️ `confirmText`, which is what ConfirmOptions declares — there is no
        cancelLabel, and the dialog's own "Cancel" is the right word anyway.

        🔴 NOT `danger: true`. The dialog supports it and this is not that: a
        teacher letting a school contact them is an ordinary, reversible-enough
        decision, and dressing it in red would tell them they are doing
        something risky. The weight here belongs in the SENTENCE, not the
        colour.
      */
      confirmText: 'Yes, let them contact me',
    });

    if (!ok) return;

    this.answer(row, true);
  }

  /**
   * Declining. No confirmation — it grants nothing and costs the teacher
   * nothing, and a dialog in front of "no thanks" is friction for its own sake.
   */
  protected decline(row: MyInvitation): void {
    this.answer(row, false);
  }

  private answer(row: MyInvitation, accept: boolean): void {
    if (this.answering() !== null) return;

    this.answering.set(row.inviteId);

    this.invitations.respond(row.inviteId, accept, this.remarks()).subscribe({
      next: () => {
        this.answering.set(null);
        this.replyingTo.set(null);

        /*
          ⚠️ The ACCEPT message states the fact, without celebrating it. The
          teacher has agreed to be contacted — that is a thing to confirm, not
          an achievement to congratulate them for.
        */
        this.toast.success(accept
          ? `${row.schoolName} can now contact you.`
          : 'Thanks — we have told them you passed on this one.');

        /*
          🔴 RE-READ rather than patching the row. The status, its
          teacher-facing name and the timestamps all move together, and 5B's
          lesson was a response that reported four fields stale because the
          client patched one.
        */
        this.load();
      },
      error: (error: unknown) => {
        this.answering.set(null);

        const code = (error as { error?: { code?: string } })?.error?.code ?? null;
        const message = (error as { error?: { message?: string } })?.error?.message
          ?? 'That could not be saved.';

        /*
          ⚠️ INVITE_NOT_OPEN is almost always a second tab, and the server's
          message names which answer was already given. Showing it verbatim is
          more useful than "something went wrong", and re-reading puts the
          screen in step with reality.
        */
        this.toast.error(message);

        if (code === 'INVITE_NOT_OPEN' || code === 'CONCURRENCY_CONFLICT') {
          this.load();
        }
      },
    });
  }

  /** Where an invitation points. Null when the school named no job. */
  protected jobLink(row: MyInvitation): string | null {
    return row.jobId ? `/jobs/${row.jobId}` : null;
  }

  protected openJob(row: MyInvitation): void {
    const link = this.jobLink(row);
    if (link) void this.router.navigateByUrl(link);
  }

  /** The badge's tone, from the stored id — never from the display text (2.21). */
  protected tone(statusId: number): 'info' | 'success' | 'neutral' {
    if (statusId === INVITE_STATUS.accepted) return 'success';
    if (statusId === INVITE_STATUS.sent || statusId === INVITE_STATUS.viewed) return 'info';

    return 'neutral';
  }

  protected salary(row: MyInvitation): string | null {
    if (row.salaryMin === null && row.salaryMax === null) return null;

    const range = row.salaryMin !== null && row.salaryMax !== null
      ? `₹${row.salaryMin}–${row.salaryMax}`
      : `₹${row.salaryMin ?? row.salaryMax}`;

    return row.isSalaryNegotiable ? `${range} a month, negotiable` : `${range} a month`;
  }
}
