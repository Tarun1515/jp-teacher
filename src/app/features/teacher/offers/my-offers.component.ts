import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmDialogService, ToastService } from 'jp-shared/core';
import { UiBadgeComponent, UiEmptyStateComponent } from 'jp-shared/ui';

import { MyOffer, OFFER_STATUS, OfferService } from '../../../core/offer.service';

/**
 * The teacher's offers — the document's side of 2.73's two machines.
 *
 * ----------------------------------------------------------------------------
 * 🔴 TWO MACHINES STAY TWO ON SCREEN
 * ----------------------------------------------------------------------------
 * 2.73 keeps the OFFER (Sent → Accepted / Declined / Withdrawn) separate from
 * the APPLICATION (… → Selected → OfferSent → OfferAccepted → Hired), because
 * a teacher reading "Declined" has to know whether that is this offer or their
 * candidacy.
 *
 * So this screen shows offers and says nothing about application stages, and
 * "My applications" shows stages and says nothing about offer documents. Each
 * links to the other rather than summarising it — a summary is where the two
 * would start to disagree.
 *
 * ----------------------------------------------------------------------------
 * 🔴 ACCEPTING IS NOT ARRIVING, AND THE SCREEN SAYS SO
 * ----------------------------------------------------------------------------
 * The school confirms the hire as a separate step (2.73), so an accepted offer
 * is not a job started. The row says what is still outstanding instead of
 * reading like a conclusion.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ A WITHDRAWN OFFER CARRIES NO REASON, AND THAT IS DELIBERATE
 * ----------------------------------------------------------------------------
 * 018 stores the school's note and never sends it. "We filled the post
 * internally" is not a sentence the school chose to say to this teacher, so the
 * screen does not invent one either — it says the offer was withdrawn and
 * leaves it there.
 */
@Component({
  selector: 'app-my-offers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, UiBadgeComponent, UiEmptyStateComponent],
  templateUrl: './my-offers.component.html',
  styleUrl: './my-offers.component.scss',
})
export class MyOffersComponent {
  private readonly offers = inject(OfferService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);

  protected readonly rows = signal<MyOffer[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly answering = signal<number | null>(null);

  protected readonly remarks = signal('');
  protected readonly replyingTo = signal<number | null>(null);

  protected readonly STATUS = OFFER_STATUS;

  /** The one that can still be answered, if there is one. */
  protected readonly live = computed(() => this.rows().filter((r) => r.isLive));
  protected readonly past = computed(() => this.rows().filter((r) => !r.isLive));

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.offers.list().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: () => {
        /*
          🔴 A FAILED LOAD IS NOT "NO OFFERS". For a teacher waiting on one,
          those two sentences are very different, and showing the wrong one is
          how somebody stops checking.
        */
        this.rows.set([]);
        this.loading.set(false);
        this.failed.set(true);
      },
    });
  }

  protected toggleReply(offerId: number): void {
    this.remarks.set('');
    this.replyingTo.set(this.replyingTo() === offerId ? null : offerId);
  }

  /**
   * Accepting. Confirmed, because it is a commitment with a date in it.
   */
  protected async accept(row: MyOffer): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Accept the offer from ${row.schoolName}?`,

      /*
        🔴 THE SENTENCE NAMES WHAT IS NOT YET TRUE.

        2.73's second step is the school confirming the hire, and a teacher who
        reads "accepted" as "hired" may stop looking. So the confirmation says
        the school still has to confirm — the one thing that is easy to assume
        wrongly here.
      */
      message:
        `${row.schoolName} will be told you have accepted${row.joiningDate ? `, joining ${row.joiningDate}` : ''}. `
        + 'They still confirm the hire as a separate step, so this is not a start date yet. '
        + 'You can keep applying elsewhere until they do.',
      confirmText: 'Accept the offer',
    });

    if (!ok) return;

    this.answer(row, true);
  }

  /**
   * Declining. Confirmed too, and this one is the DANGEROUS direction — a
   * declined offer cannot be un-declined by the teacher, and the school has to
   * choose to send another (2.73 allows it, but it is their call).
   */
  protected async decline(row: MyOffer): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Decline the offer from ${row.schoolName}?`,
      message:
        'They will be told. If you change your mind afterwards, only the school can send a new offer '
        + '— you cannot take this one back.',
      confirmText: 'Decline',
      danger: true,
    });

    if (!ok) return;

    this.answer(row, false);
  }

  private answer(row: MyOffer, accept: boolean): void {
    if (this.answering() !== null) return;

    this.answering.set(row.offerId);

    this.offers.respond(row.offerId, accept, this.remarks()).subscribe({
      next: () => {
        this.answering.set(null);
        this.replyingTo.set(null);

        this.toast.success(accept
          ? `${row.schoolName} has been told you accepted.`
          : 'They have been told you declined.');

        /*
          🔴 RE-READ, do not patch. The offer's status, its teacher-facing name,
          isLive and the application's own stage all move in one transaction —
          and 5B's lesson was four fields reported stale because the client
          patched one of them.
        */
        this.load();
      },
      error: (error: unknown) => {
        this.answering.set(null);

        const message = (error as { error?: { message?: string } })?.error?.message
          ?? 'That could not be saved.';

        /*
          ⚠️ The server's own sentence. An offer withdrawn while this tab was
          open comes back with a message naming what happened, and that is more
          useful than "something went wrong" — then the screen re-reads so it
          stops offering a button for an offer that is gone.
        */
        this.toast.error(message);
        this.load();
      },
    });
  }

  /** The badge's tone, from the stored id — never the display text (2.21). */
  protected tone(statusId: number): 'info' | 'success' | 'neutral' | 'warning' {
    if (statusId === OFFER_STATUS.accepted) return 'success';
    if (statusId === OFFER_STATUS.sent) return 'info';
    if (statusId === OFFER_STATUS.withdrawn) return 'warning';

    return 'neutral';
  }

  protected salary(row: MyOffer): string | null {
    return row.offeredSalary === null ? null : `₹${row.offeredSalary} a month`;
  }

  /** "09:00:00" → "9:00 am". The wire carries time(0); nobody reads seconds. */
  protected reportingTime(value: string | null): string | null {
    if (!value) return null;

    const [h, m] = value.split(':').map(Number);
    if (Number.isNaN(h)) return value;

    const hour12 = h % 12 === 0 ? 12 : h % 12;

    return `${hour12}:${String(m ?? 0).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  }
}
