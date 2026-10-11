import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { JP_API_CONFIG } from 'jp-shared/core';
import { Observable, map } from 'rxjs';

/**
 * 🔒 Invitations a school has sent this teacher. Phase 6B backend, 6C-2 screen.
 *
 * ----------------------------------------------------------------------------
 * 🔒 ACCEPTING IS CONSENT, AND IT IS THE SECOND AND FINAL PATH
 * ----------------------------------------------------------------------------
 * 2.56 (LOCKED) allows exactly two ways a school ever reaches a teacher's
 * contact details: the teacher applied to one of its jobs, or the teacher
 * ACCEPTED an invitation from it. Nothing else — not viewing, not ignoring, and
 * never the school's payment status.
 *
 * So the accept button on this screen is one of two places in the entire
 * product where a teacher gives that permission away. The screen says so in
 * those words before the click, because a consent somebody did not understand
 * they were giving is not consent.
 *
 * ----------------------------------------------------------------------------
 * 🔴 THE WORDING IS THE TEACHER'S, AND IT ARRIVES ON THE ROW
 * ----------------------------------------------------------------------------
 * `inviteStatusName` is m_app_invite_status.TeacherFacingName — "Invitation
 * received", "You passed on this" — not the school's vocabulary. 5B's lesson:
 * a filter must never say "Rejected" above a row that says "Not selected", so
 * no teacher screen reads the school's names at all. This app does not fetch
 * the invite-status master.
 */

/** One invitation, as the teacher reads it. */
export interface MyInvitation {
  inviteId: number;
  inviteUid: string;

  /**
   * ⚠️ Nullable, and its absence is the point of the feature: a school may
   * invite somebody WITHOUT having posted a job. "We would like to talk to you"
   * is a real thing to say.
   */
  jobId: number | null;
  jobTitle: string | null;
  subjectId: number | null;
  designationId: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  isSalaryNegotiable: boolean | null;
  lastDateToApply: string | null;

  /**
   * 🔴 The school IS named before any consent exists — the one place this
   * product deliberately shows a school to a teacher that way, because
   * "somebody wants to talk to you" is useless without knowing who.
   */
  schoolUid: string;
  schoolName: string;
  schoolLogoPath: string | null;
  isSchoolVerified: boolean;
  branchName: string;
  branchCityId: number | null;
  branchStateId: number | null;

  message: string | null;

  inviteStatusId: number;

  /** The TEACHER's wording, from the master. See the header. */
  inviteStatusName: string;

  /** Sent or Viewed — the only states that can still be answered. */
  isOpen: boolean;

  sentOn: string;
  viewedOn: string | null;
  respondedOn: string | null;
  teacherRemarks: string | null;
  rowVersion: number;
  isActive: boolean;
}

/** ⚠️ ids from `m_app_invite_status` (027). 3 is the one IsConsent row. */
export const INVITE_STATUS = {
  sent: 1,
  viewed: 2,
  accepted: 3,
  applied: 4,
  ignored: 5,
} as const;

interface Envelope<T> {
  status: number;
  code: string | null;
  message: string;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class InvitationService {
  private readonly api = inject(JP_API_CONFIG);
  private readonly http = inject(HttpClient);

  private readonly baseUrl = `${this.api.appApiUrl}/teacher/invites`;

  /** Every invitation this teacher has, or only the ones still answerable. */
  list(openOnly = false): Observable<MyInvitation[]> {
    let params = new HttpParams();
    if (openOnly) params = params.set('openOnly', 'true');

    return this.http
      .get<Envelope<MyInvitation[]>>(this.baseUrl, { params })
      .pipe(map((r) => r.data ?? []));
  }

  /**
   * Stamps an invitation as seen.
   *
   * 🔒 VIEWING UNLOCKS NOTHING. 2.56 is explicit about it, and
   * `fn_TeacherContactUnlocked` matches status 3 and only 3 — a Viewed
   * invitation is not an IsConsent row. This call exists so the school can tell
   * "not read yet" from "read and thinking about it", which is information they
   * can act on honestly.
   *
   * ⚠️ Idempotent: the procedure only moves status 1, so a second call on an
   * answered invitation changes nothing and still succeeds (2.48's shape).
   */
  markViewed(inviteId: number): Observable<void> {
    return this.http
      .post<Envelope<unknown>>(`${this.baseUrl}/${inviteId}/viewed`, {})
      .pipe(map(() => undefined));
  }

  /**
   * Accepts or declines.
   *
   * 🔒 `accept: true` IS the consent (2.56, path 2). After it the school can
   * see this teacher's email, mobile and resume; before it, and after a
   * decline, it can see none of them.
   *
   * ⚠️ An already-answered invitation comes back INVITE_NOT_OPEN with a message
   * naming which answer was given — almost always a second tab, so it is a
   * sentence to show rather than an error to swallow.
   */
  respond(inviteId: number, accept: boolean, teacherRemarks?: string | null): Observable<void> {
    return this.http
      .post<Envelope<unknown>>(`${this.baseUrl}/${inviteId}/respond`, {
        accept,
        teacherRemarks: teacherRemarks?.trim() || null,
      })
      .pipe(map(() => undefined));
  }
}
