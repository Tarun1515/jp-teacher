import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { JP_API_CONFIG } from 'jp-shared/core';
import { ApiResponse } from 'jp-shared/models';
import { Observable, map } from 'rxjs';

/**
 * The job market and this teacher's applications, over HTTP.
 *
 * ----------------------------------------------------------------------------
 * 🔴 APPLYING IS FREE, AND NOTHING HERE MAY EVER CHARGE FOR IT
 * ----------------------------------------------------------------------------
 * There is no entitlement call on any of these routes and none may be added.
 * The consuming action is the SCHOOL's job publish (2.64); a QUOTA_EXHAUSTED
 * reaching a teacher would mean somebody had been charged for looking for work.
 *
 * ----------------------------------------------------------------------------
 * 🔴 ACTIVE POSTINGS ONLY, BY THE EFFECTIVE STATUS
 * ----------------------------------------------------------------------------
 * An Active job whose closing date has passed is EXPIRED: it does not list, its
 * detail answers 404, and an apply is refused with JOB_EXPIRED. All three are
 * decided on the server from the date in IST — no sweep job runs, no status is
 * stored, and nothing in this file compares a date. A browser with a wrong
 * clock must not be able to disagree about which jobs are open.
 *
 * ----------------------------------------------------------------------------
 * 🔴 NO SchoolId ANYWHERE
 * ----------------------------------------------------------------------------
 * A school is identified to a teacher by `schoolUid`, its public identifier
 * (2.39). There is no teacherId on the wire either — the server resolves the
 * teacher from the token.
 */

/** Stored application statuses, as the ids in `m_app_application_status`. */
export const APPLICATION_STATUS = {
  applied: 1,
  viewed: 2,
  shortlisted: 3,
  interview: 4,
  selected: 5,
  rejected: 6,
} as const;

export interface JobBrowseFilter {
  subjectId?: number | null;
  designationId?: number | null;
  employmentTypeId?: number | null;
  cityId?: number | null;
  stateId?: number | null;
  minSalary?: number | null;
  pageNumber?: number;
  pageSize?: number;
}

export interface JobBrowseItem {
  jobId: number;
  jobUid: string;
  jobTitle: string;
  subjectId: number;
  designationId: number;
  qualificationId: number | null;
  employmentTypeId: number;
  noOfVacancies: number;
  minExperienceMonths: number | null;
  maxExperienceMonths: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  isSalaryNegotiable: boolean;
  cityId: number | null;
  stateId: number | null;
  lastDateToApply: string | null;
  expectedJoiningDate: string | null;
  publishedOn: string | null;

  schoolUid: string;
  schoolName: string;
  schoolLogoPath: string | null;
  isSchoolVerified: boolean;
  branchName: string;

  /**
   * 🔴 DERIVED on every read — a COUNT of live application rows.
   *
   * `t_app_jobs.ApplicationCount` exists, stays at zero and is never written
   * (024). A maintained counter is a second source of truth that drifts
   * silently, and the number on a card would stop matching reality with
   * nothing erroring.
   */
  applicationCount: number;

  hasApplied: boolean;
  isSaved: boolean;

  /** 🔴 Arrives through an alias in the procedure (2.61). */
  isActive: boolean;
}

export interface JobForTeacher extends JobBrowseItem {
  workingDays: string | null;
  timingFrom: string | null;
  timingTo: string | null;
  jobDescription: string | null;
  aboutSchool: string | null;
  branchCityId: number | null;
  branchStateId: number | null;
  subjectIds: number[];
  classLevelIds: number[];
}

export interface ApplyResult {
  applicationId: number;

  /**
   * ⚠️ `ALREADY_APPLIED` arrives on a SUCCESS (HTTP 200). It is a double-tap,
   * or the loser of a genuinely parallel double-apply, resolving to the
   * application that already exists. Treating it as a failure would send
   * somebody to support over a working application.
   */
  code: string | null;

  /** False when the row already existed. */
  created: boolean;
}

export interface MyApplicationListItem {
  applicationId: number;
  applicationUid: string;
  jobId: number;
  jobUid: string;
  jobTitle: string;
  subjectId: number;
  designationId: number;
  employmentTypeId: number;
  salaryMin: number | null;
  salaryMax: number | null;
  isSalaryNegotiable: boolean;
  lastDateToApply: string | null;
  jobStatusId: number;

  schoolUid: string;
  schoolName: string;
  schoolLogoPath: string | null;
  branchName: string;
  branchCityId: number | null;
  branchStateId: number | null;

  applicationStatusId: number;

  /**
   * 🔴 THE TEACHER'S WORDING, from `m_app_application_status.TeacherFacingName`.
   *
   * Rejected reads "Not selected" and Viewed reads "Seen by the school". The
   * school's own vocabulary is never sent here, and neither is the school's
   * private rejection note — that column is not in the teacher's procedures at
   * all (017).
   */
  statusName: string;

  appliedOn: string;
  viewedOn: string | null;
  coverNote: string | null;
  hasResume: boolean;
  isActive: boolean;
}

/** One step of the journey, as the teacher is shown it. */
export interface MyApplicationStep {
  toStatusId: number;
  statusName: string;
  changedOn: string;
}

export interface MyApplicationDetail extends MyApplicationListItem {
  qualificationId: number | null;
  noOfVacancies: number;
  minExperienceMonths: number | null;
  maxExperienceMonths: number | null;
  workingDays: string | null;
  timingFrom: string | null;
  timingTo: string | null;
  expectedJoiningDate: string | null;
  jobDescription: string | null;
  history: MyApplicationStep[];
}

export interface SavedJob {
  savedJobId: number;
  savedOn: string;
  jobId: number;
  jobUid: string;
  jobTitle: string;
  subjectId: number;
  designationId: number;
  employmentTypeId: number;
  salaryMin: number | null;
  salaryMax: number | null;
  isSalaryNegotiable: boolean;
  cityId: number | null;
  stateId: number | null;
  lastDateToApply: string | null;
  jobStatusId: number;
  schoolUid: string;
  schoolName: string;
  schoolLogoPath: string | null;
  branchName: string;
  hasApplied: boolean;
  isActive: boolean;
}

export interface ToggleSavedResult {
  jobId: number;
  isSaved: boolean;
}

export interface RecentMyApplication {
  applicationId: number;
  applicationUid: string;
  jobId: number;
  jobTitle: string;
  schoolUid: string;
  schoolName: string;
  schoolLogoPath: string | null;
  applicationStatusId: number;
  statusName: string;
  appliedOn: string;
  viewedOn: string | null;
}

export interface TeacherApplicationStats {
  totalApplications: number;
  appliedCount: number;
  viewedCount: number;
  shortlistedCount: number;
  interviewCount: number;
  selectedCount: number;
  rejectedCount: number;
  savedJobCount: number;
  recent: RecentMyApplication[];
}

export interface JobPage {
  rows: JobBrowseItem[];
  total: number;
}

@Injectable({ providedIn: 'root' })
export class JobSearchService {
  private readonly api = inject(JP_API_CONFIG);
  private readonly http = inject(HttpClient);

  private readonly jobsUrl = `${this.api.appApiUrl}/teacher/jobs`;
  private readonly applicationsUrl = `${this.api.appApiUrl}/teacher/applications`;

  // ---- jobs ---------------------------------------------------------------

  /**
   * Open postings.
   *
   * ⚠️ Paged on the SERVER. `totalRecords` is the count before paging, so the
   * pager describes the whole result rather than the slice in hand.
   */
  browse(filter: JobBrowseFilter = {}): Observable<JobPage> {
    let params = new HttpParams();

    const set = (key: string, value: number | null | undefined) => {
      if (value !== null && value !== undefined) params = params.set(key, value);
    };

    set('subjectId', filter.subjectId);
    set('designationId', filter.designationId);
    set('employmentTypeId', filter.employmentTypeId);
    set('cityId', filter.cityId);
    set('stateId', filter.stateId);
    set('minSalary', filter.minSalary);
    set('pageNumber', filter.pageNumber);
    set('pageSize', filter.pageSize);

    return this.http
      .get<ApiResponse<JobBrowseItem[]>>(this.jobsUrl, { params })
      .pipe(map((r) => ({ rows: r.data ?? [], total: r.totalRecords ?? 0 })));
  }

  /**
   * One posting.
   *
   * 🔴 An EXPIRED or CLOSED job answers 404 — the same as one that never
   * existed. This is the URL somebody bookmarks or is mailed a month later,
   * and a page carrying an Apply button the server will refuse is worse than an
   * honest "this posting has gone".
   */
  get(jobId: number): Observable<JobForTeacher> {
    return this.http
      .get<ApiResponse<JobForTeacher>>(`${this.jobsUrl}/${jobId}`)
      .pipe(map((r) => r.data as JobForTeacher));
  }

  /**
   * Save or unsave — the teacher's own private shortlist.
   *
   * 🔴 SAVING IS NOT APPLYING, AND IT UNLOCKS NOTHING. The school is told
   * nothing by this: `fn_TeacherContactUnlocked` does not read
   * `t_app_saved_jobs` and must never be made to (2.56). Saving is interest;
   * applying is consent.
   *
   * ⚠️ A toggle, not a create. Unsaving and saving again revives the same row
   * (2.4), and the response says which state it ended in — so the caller uses
   * the answer rather than assuming the opposite of what it had.
   */
  toggleSaved(jobId: number): Observable<ToggleSavedResult> {
    return this.http
      .post<ApiResponse<ToggleSavedResult>>(`${this.jobsUrl}/${jobId}/save`, {})
      .pipe(map((r) => r.data as ToggleSavedResult));
  }

  savedJobs(): Observable<SavedJob[]> {
    return this.http
      .get<ApiResponse<SavedJob[]>>(`${this.jobsUrl}/saved`)
      .pipe(map((r) => r.data ?? []));
  }

  // ---- applications -------------------------------------------------------

  /**
   * Apply. 🔒 THIS IS CONSENT PATH 1 (2.56).
   *
   * ⚠️ It is the act that opens this teacher's contact details to THIS school
   * and no other, and it cannot be undone from here — withdrawing an
   * application is not in the product (G28). The screen says so before it calls
   * this.
   *
   * 🔴 The resume is snapshotted server-side at this moment. Replacing the CV
   * afterwards does not change what the school was sent.
   */
  apply(jobId: number, coverNote?: string | null): Observable<ApplyResult> {
    return this.http
      .post<ApiResponse<ApplyResult>>(this.applicationsUrl, { jobId, coverNote })
      .pipe(map((r) => r.data as ApplyResult));
  }

  myApplications(statusId?: number | null): Observable<MyApplicationListItem[]> {
    let params = new HttpParams();
    if (statusId) params = params.set('statusId', statusId);

    return this.http
      .get<ApiResponse<MyApplicationListItem[]>>(this.applicationsUrl, { params })
      .pipe(map((r) => r.data ?? []));
  }

  myApplication(applicationId: number): Observable<MyApplicationDetail> {
    return this.http
      .get<ApiResponse<MyApplicationDetail>>(`${this.applicationsUrl}/${applicationId}`)
      .pipe(map((r) => r.data as MyApplicationDetail));
  }

  stats(): Observable<TeacherApplicationStats> {
    return this.http
      .get<ApiResponse<TeacherApplicationStats>>(`${this.applicationsUrl}/stats`)
      .pipe(map((r) => r.data as TeacherApplicationStats));
  }
}

/**
 * The refusal codes an apply can produce, as sentences a teacher can act on.
 *
 * ----------------------------------------------------------------------------
 * 🔴 TWO OF THESE ARE RENDERED IN PLACE, NOT TOASTED
 * ----------------------------------------------------------------------------
 * RESUME_REQUIRED and JOB_EXPIRED are listed in the shared interceptor's
 * COMPONENT_RENDERED_CODES, because each has a NEXT STEP a toast cannot carry:
 * one links to the resume section of the profile, the other replaces the Apply
 * button with the date applications closed.
 *
 * ⚠️ The others keep their toast, and adding one to that set without rendering
 * it would turn a refusal into silence.
 *
 * ⚠️ NOTHING HERE IS AN ENTITLEMENT CODE. Applying is free (2.64).
 */
export function applyRefusalMessage(code: string | null | undefined, fallback: string): string {
  switch (code) {
    case 'RESUME_REQUIRED':
      return 'Schools read a resume first, so one is needed before you can apply.';

    case 'JOB_EXPIRED':
      return 'This posting has closed and is no longer accepting applications.';

    case 'APPLY_CONFLICT':
      /*
        ⚠️ Says nothing about the teacher and nothing about the job — it is a
        collision between two requests, and the only useful instruction is to
        try again.
      */
      return 'That did not go through. Please try again.';

    default:
      return fallback;
  }
}
