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
