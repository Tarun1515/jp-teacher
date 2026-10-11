import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { JP_API_CONFIG } from 'jp-shared/core';
import { Observable, map } from 'rxjs';

/**
 * Offers a school has made this teacher. Phase 6A backend, 6C-2 screen.
 *
 * ----------------------------------------------------------------------------
 * 🔴 TWO MACHINES, AND THIS IS THE DOCUMENT'S ONE
 * ----------------------------------------------------------------------------
 * 2.73: an offer is a DOCUMENT (Sent → Accepted / Declined / Withdrawn); an
 * application is where the CANDIDATE stands (… → Selected → OfferSent →
 * OfferAccepted → Hired). They move in one transaction and answer different
 * questions, and conflating them is the mistake that schema is shaped to
 * prevent.
 *
 * So this service reads offers, and the application's own stage stays on the
 * applications screen. A teacher looking at "Declined" needs to know whether
 * that is THIS offer or their candidacy — and 2.73's answer is that those are
 * two sentences, not one.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE WORDING IS THE TEACHER'S, AND THE SCHOOL'S REASON NEVER ARRIVES
 * ----------------------------------------------------------------------------
 * `offerStatusName` is m_app_offer_status.TeacherFacingName — "Offer received",
 * "You declined". And a WITHDRAWN offer carries no reason: 018 stores the
 * school's note and never sends it, because "we filled the post internally" is
 * not a sentence a school chose to say to this teacher.
 */

/** One offer, as the teacher reads it. */
export interface MyOffer {
  offerId: number;
  offerUid: string;
  applicationId: number;
  jobId: number;
  jobTitle: string;
  designationId: number;
  offeredSalary: number | null;
  joiningDate: string | null;

  /** ⚠️ time(0) on the wire — "09:00:00", not a date. */
  reportingTime: string | null;

  termsAndConditions: string | null;

  offerStatusId: number;

  /** The TEACHER's wording, from the master. See the header. */
  offerStatusName: string;

  /** The one offer on this application that is still answerable. */
  isLive: boolean;

  sentOn: string;
  respondedOn: string | null;
  teacherRemarks: string | null;

  schoolUid: string;
  schoolName: string;
  schoolLogoPath: string | null;
  branchName: string;
  isActive: boolean;
}

/** ⚠️ ids from `m_app_offer_status` (025). 1 is the live one. */
export const OFFER_STATUS = {
  sent: 1,
  accepted: 2,
  declined: 3,
  withdrawn: 4,
} as const;

interface Envelope<T> {
  status: number;
  code: string | null;
  message: string;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class OfferService {
  private readonly api = inject(JP_API_CONFIG);
  private readonly http = inject(HttpClient);

  private readonly baseUrl = `${this.api.appApiUrl}/teacher/offers`;

  /**
   * Every offer this teacher has had, or only the live one.
   *
   * ⚠️ The history matters: 2.73 allows a school to offer again after a
   * decline, so a teacher may legitimately have three offers on one
   * application. Showing only the live one would hide the negotiation they were
   * part of.
   */
  list(liveOnly = false): Observable<MyOffer[]> {
    let params = new HttpParams();
    if (liveOnly) params = params.set('liveOnly', 'true');

    return this.http
      .get<Envelope<MyOffer[]>>(this.baseUrl, { params })
      .pipe(map((r) => r.data ?? []));
  }

  /**
   * Accepts or declines.
   *
   * 🔴 ACCEPTING IS NOT ARRIVING. 2.73 keeps "accepted" and "hired" as two
   * steps on purpose: the school confirms the hire separately, and collapsing
   * them would record people as hired who never started — the number a school
   * may one day be asked to stand behind.
   *
   * ⚠️ Another teacher's offer id answers NOT_FOUND, never "not yours" (2.6).
   * The procedure matches on the caller's own UserUid, so there is no id to
   * probe with.
   */
  respond(offerId: number, accept: boolean, teacherRemarks?: string | null): Observable<void> {
    return this.http
      .post<Envelope<unknown>>(`${this.baseUrl}/${offerId}/respond`, {
        accept,
        teacherRemarks: teacherRemarks?.trim() || null,
      })
      .pipe(map(() => undefined));
  }
}
