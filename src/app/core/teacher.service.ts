import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { JP_API_CONFIG, SKIP_LOADER } from 'jp-shared/core';
import { ApiResponse, DocumentType } from 'jp-shared/models';
import { Observable, map } from 'rxjs';

/**
 * The slice of /api/masters/bulk this app reads.
 *
 * 🔴 Document types come from HERE, not from /api/masters/document-type.
 *
 * The generic master shape drops the three fields that make a document type
 * useful — IsMandatory, MaxSizeKb and AllowedExtensions — and 2.47 puts those
 * limits in data precisely so nothing has to guess them. jp-school learned this
 * the hard way in 2F: a form where nothing was ever marked required.
 */
interface MasterBundle {
  documentTypes: DocumentType[];
}

/*==============================================================================
  THE TEACHER'S OWN PROFILE

  🔴 NOTHING HERE SENDS A TEACHER ID. The server resolves the teacher from the
  token (2.54) — no write procedure in the database even takes one, verified
  against sys.parameters — so "edit somebody else's profile" cannot be expressed
  at any layer, including this one.
==============================================================================*/

export interface TeacherLanguage {
  languageId: number;

  /** 1 basic · 2 conversational · 3 fluent · 4 native. Null = not said. */
  proficiencyLevel: number | null;
}

export interface TeacherLocation {
  /** ⚠️ Null means "anywhere in this state" — a real preference, not a gap (2.47). */
  cityId: number | null;
  stateId: number;
  preferenceOrder: number;

  /*
    🔴 THE FIELD THAT WAS MISSING WHILE THE COLUMN EXISTED.

    `t_app_teacher_preferred_locations.TehsilId` has been there since 036, and
    until 15 Nov 2026 `dbo.PreferredLocationList` — the table type the save goes
    through — had no column for it. The picker on this screen accepted a tehsil,
    the section reported "Saved", and the value was dropped at that boundary.

    Both halves landed together this time: the type, the save procedure, the
    read, this interface, and the control.
  */
  tehsilId: number | null;
}

export interface TeacherExperience {
  id: number;
  schoolName: string;
  designationId: number | null;
  subjectId: number | null;
  fromDate: string;
  toDate: string | null;
  isCurrent: boolean;
}

/*
  ⚠️ WHETHER THIS TEACHER CAN ASK TO BE VERIFIED.

  🔴 Until 15 Nov 2026 there was nothing to ask WITH. Nothing in the product
  created a TEACHER_VERIFY approval request — the documents landed on the
  profile, a "needed" chip was drawn beside the mandatory ones, and the whole
  approval path behind it (queue, document review, the badge) was reachable only
  by hand.

  🔒 NO AADHAAR OR PAN NUMBER (2.50). `missingDocument` is a document type's
  NAME from the master. No field here, and no column behind it, holds either
  number — the document is the record and an admin's eyes verify it.

  ⚠️ `canRequest` COMES FROM THE SERVER rather than being derived here from the
  other three. The same rule decides whether the button works, so the screen
  reads the answer instead of re-implementing it and risking a button that is
  enabled over a refusal.
*/
export interface TeacherVerificationReadiness {
  isVerified: boolean;
  documentCount: number;

  /** The first mandatory document not uploaded, in the order shown. */
  missingDocument: string | null;

  canRequest: boolean;
}

export interface TeacherVerificationResult {
  requestId: number;
  requestNo: string;

  /** A request was already awaiting review — not an error (idempotent submit). */
  alreadyPending: boolean;

  message: string;
}

export interface TeacherDocument {
  documentId: number;
  documentTypeId: number;
  fileName: string;
  fileSizeKb: number;
  mimeType: string;
  isVerified: boolean;
  verifiedOn: string | null;
  createdOn: string;
}

export interface TeacherProfile {
  teacherId: number;
  teacherUid: string;

  fullName: string;
  photoPath: string | null;
  dob: string | null;
  genderId: number | null;
  qualificationId: number | null;
  highestQualificationText: string | null;
  designationId: number | null;

  /**
   * 🔴 DERIVED SERVER-SIDE, and recomputed on every experience change (2.54).
   *
   * ⚠️ Never computed or sent by this client. 3B found hand-written totals
   * disagreeing with their own experience rows by up to thirteen months, and 3D
   * found DATEDIFF(MONTH) undercounting every closed job by one. One place
   * calculates this, and it is not here.
   */
  totalExperienceMonths: number | null;

  currentSchool: string | null;
  lastSchool: string | null;
  expectedSalaryMin: number | null;
  expectedSalaryMax: number | null;
  currentCityId: number | null;
  currentStateId: number | null;

  /*
    The rest of the address chain, to match the school's — client instruction,
    15 Nov 2026. State and city were already here; district, tehsil and
    area/village are new (039_alter_teacher_address_columns.sql).

    ⚠️ DISTRICT IS A STORED FIELD NOW, not a display-only step. This screen used
    to rebuild it from the saved city on every re-open (`districtOfCity`), which
    held only because a city belongs to one district — and stops holding under a
    tehsil, which sits between them.
  */
  currentDistrictId: number | null;
  currentTehsilId: number | null;
  currentAreaOrVillage: string | null;

  /*
    D1. THE MAP PIN — where "nearby jobs first" measures from.

    🔴 NULL IS A REAL AND COMMON STATE, AND THE PRODUCT MUST KEEP SAYING SO.
    No pin means nobody asked, and the job browse then returns exactly the date
    order it returned before this feature existed. There is NO fallback to the
    centroid of `currentCityId` — a town centre is not where anybody lives, and
    "~4 km away" measured from one is a sentence we would be stating as fact
    and could not support. The screen offers the map instead of guessing.

    🔒 OWN PROFILE ONLY. These two never appear on a school-facing type; what a
    school's side of the product sees is a DISTANCE IN METRES on a job card,
    which cannot be turned back into somebody's front door.

    ⚠️ BOTH OR NEITHER. The server refuses one without the other and names
    which half is missing — half a pin is a point on the Greenwich meridian,
    which is in the Atlantic for anything in India.
  */
  latitude: number | null;
  longitude: number | null;

  aboutMe: string | null;
  resumePath: string | null;

  isVerified: boolean;
  verifiedOn: string | null;
  isSuspended: boolean;

  /** 0–100, computed by USP_RecalculateTeacherProfile. Capped at 75 with no resume. */
  profileCompletionPercent: number;

  rowVersion: number;

  subjectIds: number[];
  classLevelIds: number[];
  skillIds: number[];
  languages: TeacherLanguage[];
  preferredLocations: TeacherLocation[];
  experiences: TeacherExperience[];
  documents: TeacherDocument[];
}

/**
 * The editable half of the profile.
 *
 * ⚠️ TotalExperienceMonths, ProfileCompletionPercent, IsVerified and the paths
 * are absent: every one of them is derived or set by an upload, and a field the
 * server ignores is a field somebody will one day expect it to honour.
 */
export interface UpdateTeacherProfileBody {
  rowVersion: number;

  fullName: string;
  dob: string | null;
  genderId: number | null;
  qualificationId: number | null;
  highestQualificationText: string | null;
  designationId: number | null;
  currentSchool: string | null;
  lastSchool: string | null;
  expectedSalaryMin: number | null;
  expectedSalaryMax: number | null;
  currentCityId: number | null;
  currentStateId: number | null;

  /*
    The rest of the address chain, to match the school's — client instruction,
    15 Nov 2026. State and city were already here; district, tehsil and
    area/village are new (039_alter_teacher_address_columns.sql).

    ⚠️ DISTRICT IS A STORED FIELD NOW, not a display-only step. This screen used
    to rebuild it from the saved city on every re-open (`districtOfCity`), which
    held only because a city belongs to one district — and stops holding under a
    tehsil, which sits between them.
  */
  currentDistrictId: number | null;
  currentTehsilId: number | null;
  currentAreaOrVillage: string | null;

  /*
    D1. The map pin.

    🔴 SENT ON EVERY SAVE OF THIS ROW, INCLUDING SAVES THAT HAVE NOTHING TO DO
    WITH THE MAP. The server writes these two plainly rather than coalescing, so
    null MEANS "clear the pin" — which is what makes "remove my home
    coordinates" possible at all, and what makes a forgetful client dangerous.

    ⚠️ This screen has nine Save buttons over ONE profile row and each of them
    PUTs the whole draft, so the draft is seeded from the GET and these two ride
    along untouched unless somebody moves the pin. A section save that dropped
    the field would delete the pin while printing "Saved" — the tehsil bug
    inverted, and the reason `nearby-jobs.mjs` saves an unrelated section and
    then checks the pin is still there.
  */
  latitude: number | null;
  longitude: number | null;

  aboutMe: string | null;
}

export interface SaveExperienceBody {
  schoolName: string;
  designationId: number | null;
  subjectId: number | null;
  fromDate: string;
  toDate: string | null;
  isCurrent: boolean;
}

@Injectable({ providedIn: 'root' })
export class TeacherService {
  private readonly api = inject(JP_API_CONFIG);
  private readonly http = inject(HttpClient);

  private readonly baseUrl = `${this.api.appApiUrl}/teacher`;

  // ---- profile ------------------------------------------------------------

  getProfile(): Observable<TeacherProfile> {
    return this.http
      .get<ApiResponse<TeacherProfile>>(`${this.baseUrl}/profile`)
      .pipe(map((response) => response.data as TeacherProfile));
  }

  updateProfile(body: UpdateTeacherProfileBody): Observable<void> {
    return this.http
      .put<ApiResponse<unknown>>(`${this.baseUrl}/profile`, body)
      .pipe(map(() => undefined));
  }

  /**
   * The document types a teacher can upload, with their real limits.
   *
   * Request type 2 is teacher verification (2.47); the caller filters.
   */
  documentTypes(): Observable<DocumentType[]> {
    return this.http
      .get<ApiResponse<MasterBundle>>(`${this.api.appApiUrl}/masters/bulk`)
      .pipe(map((response) => response.data?.documentTypes ?? []));
  }

  // ---- files --------------------------------------------------------------

  /**
   * Fetches an image or document as an object URL the browser can render.
   *
   * 🔴 A URL built from the endpoint, never from a stored path. Uploads live
   * under App_Data and are not served statically — that root holds every resume
   * in the system — so the API streams them after resolving the teacher from the
   * token.
   *
   * ⚠️ These need the Authorization header, so they cannot go straight into an
   * `<img src>`. The caller must revoke the object URL when done, or the blob
   * stays in memory for the life of the tab.
   */
  loadFile(url: string): Observable<string> {
    return this.http
      .get(url, { responseType: 'blob', context: new HttpContext().set(SKIP_LOADER, true) })
      .pipe(map((blob) => URL.createObjectURL(blob)));
  }

  photoUrl(): string {
    return `${this.baseUrl}/photo/file`;
  }

  resumeUrl(): string {
    return `${this.baseUrl}/resume/file`;
  }

  documentUrl(documentId: number): string {
    return `${this.baseUrl}/documents/${documentId}/file`;
  }

  uploadPhoto(file: File): Observable<void> {
    const form = new FormData();
    form.append('file', file);

    return this.http
      .post<ApiResponse<unknown>>(`${this.baseUrl}/photo`, form)
      .pipe(map(() => undefined));
  }

  uploadResume(file: File): Observable<void> {
    const form = new FormData();
    form.append('file', file);

    return this.http
      .post<ApiResponse<unknown>>(`${this.baseUrl}/resume`, form)
      .pipe(map(() => undefined));
  }

  uploadDocument(documentTypeId: number, file: File): Observable<number> {
    const form = new FormData();
    form.append('file', file);
    form.append('documentTypeId', String(documentTypeId));

    return this.http
      .post<ApiResponse<{ documentId: number }>>(`${this.baseUrl}/documents`, form)
      .pipe(map((response) => response.data?.documentId ?? 0));
  }

  deleteDocument(documentId: number): Observable<void> {
    return this.http
      .delete<ApiResponse<unknown>>(`${this.baseUrl}/documents/${documentId}`)
      .pipe(map(() => undefined));
  }

  // ---- verification (D6) --------------------------------------------------

  /** Whether asking to be verified would work, and what is missing if not. */
  verificationReadiness(): Observable<TeacherVerificationReadiness> {
    return this.http
      .get<ApiResponse<TeacherVerificationReadiness>>(`${this.baseUrl}/verification`)
      .pipe(map((response) => response.data as TeacherVerificationReadiness));
  }

  /**
   * Submits the profile for verification.
   *
   * 🔴 NO BODY. Which teacher, which documents and which name all come from the
   * token and the stored profile — there is nothing for a caller to substitute.
   *
   * ⚠️ Idempotent on the server: a request already awaiting review comes back
   * with `alreadyPending = true` rather than becoming a second queue row.
   */
  requestVerification(): Observable<TeacherVerificationResult> {
    return this.http
      .post<ApiResponse<TeacherVerificationResult>>(`${this.baseUrl}/verification`, {})
      .pipe(map((response) => response.data as TeacherVerificationResult));
  }

  // ---- the five full-set endpoints ----------------------------------------
  //
  // 🔴 EVERY ONE OF THESE TAKES THE COMPLETE SET, NOT A DELTA (2.53, 2.54).
  // Sending only the new id removes every other one. The screen therefore always
  // sends everything currently selected, even when one chip was removed.

  saveSubjects(ids: number[]): Observable<void> {
    return this.putSet('subjects', { ids });
  }

  saveClassLevels(ids: number[]): Observable<void> {
    return this.putSet('class-levels', { ids });
  }

  saveSkills(ids: number[]): Observable<void> {
    return this.putSet('skills', { ids });
  }

  /** ⚠️ A language that is kept but re-rated is UPDATED in place, not replaced. */
  saveLanguages(languages: TeacherLanguage[]): Observable<void> {
    return this.putSet('languages', { languages });
  }

  savePreferredLocations(locations: TeacherLocation[]): Observable<void> {
    return this.putSet('preferred-locations', { locations });
  }

  private putSet(path: string, body: unknown): Observable<void> {
    return this.http
      .put<ApiResponse<unknown>>(`${this.baseUrl}/${path}`, body)
      .pipe(map(() => undefined));
  }

  // ---- experiences — entities, NOT a set ----------------------------------
  //
  // ⚠️ Each row is added, edited and removed on its own. Two roles at one school
  // starting the same month are legitimate — a part-time subject teacher who
  // also ran the sports programme — which is why the table has no unique index
  // (2.51) and why this is not a full-set sync.

  addExperience(body: SaveExperienceBody): Observable<number> {
    return this.http
      .post<ApiResponse<{ id: number }>>(`${this.baseUrl}/experiences`, body)
      .pipe(map((response) => response.data?.id ?? 0));
  }

  updateExperience(id: number, body: SaveExperienceBody): Observable<void> {
    return this.http
      .put<ApiResponse<unknown>>(`${this.baseUrl}/experiences/${id}`, body)
      .pipe(map(() => undefined));
  }

  deleteExperience(id: number): Observable<void> {
    return this.http
      .delete<ApiResponse<unknown>>(`${this.baseUrl}/experiences/${id}`)
      .pipe(map(() => undefined));
  }
}
