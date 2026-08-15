import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { JP_API_CONFIG } from 'jp-shared/core';
import { ApiResponse } from 'jp-shared/models';
import { Observable, map } from 'rxjs';

/**
 * The plan an account is on.
 *
 * ⚠️ `hasSubscription: false` is a real state. Provisioning gives every account
 * a plan, and 3B's repair left the possibility of one without — the screen says
 * so rather than showing a blank.
 */
export interface PlanSummary {
  hasSubscription: boolean;
  planName: string | null;
  planCode: string | null;
  price: number | null;
  endsOnUtc: string | null;
  startsOnUtc: string | null;

  /**
   * 🔴 Only correct because the procedure aliases `Is_Active AS IsActive`
   * (2.61). Without the alias it arrives false with nothing failing.
   */
  isActive: boolean;
}

/**
 * 🔴 NO JOB COUNT, NO APPLICATION COUNT.
 *
 * Neither table exists — jobs are Phase 4, applications Phase 5. A zero here
 * would be a measurement of something unmeasurable, and a number would be the
 * mockup 3I removed (G6).
 */
export interface TeacherDashboard {
  fullName: string;

  /** ⚠️ A badge, not a gate (2.9). Everything works unverified. */
  isVerified: boolean;
  verifiedOnUtc: string | null;
  isSuspended: boolean;

  profileCompletionPercent: number;
  hasResume: boolean;

  subjectCount: number;
  experienceCount: number;

  /** Derived server-side, never computed by a client (2.54). */
  totalExperienceMonths: number | null;

  documentCount: number;
  verifiedDocumentCount: number;

  plan: PlanSummary;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly api = inject(JP_API_CONFIG);
  private readonly http = inject(HttpClient);

  getTeacher(): Observable<TeacherDashboard> {
    return this.http
      .get<ApiResponse<TeacherDashboard>>(`${this.api.appApiUrl}/dashboard/teacher`)
      .pipe(map((response) => response.data as TeacherDashboard));
  }
}
