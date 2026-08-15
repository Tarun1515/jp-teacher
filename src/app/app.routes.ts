import { Routes } from '@angular/router';
import { activeAccountGuard, authGuard, guestGuard, unsavedChangesGuard } from 'jp-shared/core';

import { TeacherLayoutComponent } from './layouts/teacher-layout.component';

/**
 * Route map for the teacher app.
 *
 * ----------------------------------------------------------------------------
 * NO APP PREFIX IN THE PATHS
 * ----------------------------------------------------------------------------
 * These used to be /teacher/dashboard, because one application served all three
 * audiences. Now that each has its own deployment the prefix would just repeat
 * the hostname — teacher.staffroom.in/teacher/dashboard reads like a mistake.
 *
 * ⚠️ The seeded menu rows in database/jp_sso/03_seed/005_seed_menus.sql carry
 * the matching RoutePath. Add a route here and add the row in the same commit;
 * a menu row pointing at a route that does not exist is a 404, and a route with
 * no menu row is invisible.
 *
 * Guard order is deliberate and applies everywhere:
 *
 *   authGuard          -> is there a session at all?
 *   activeAccountGuard -> has the account been approved?
 *   permissionGuard    -> may they perform this specific action?
 *
 * roleGuard is gone: this app serves exactly one user type, and the token's
 * utype is checked by AppAccessService before any route renders.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },

  // ---- public / unauthenticated -------------------------------------------
  {
    path: 'auth',
    canActivate: [guestGuard],
    children: [
      {
        path: 'login',
        loadComponent: () =>
          import('./features/auth/login/login.component').then((m) => m.LoginComponent),
      },
      {
        // Teacher registration only — no toggle, for the same reason as school.
        path: 'register',
        loadComponent: () =>
          import('./features/auth/register/register.component').then((m) => m.RegisterComponent),
      },
      {
        path: 'forgot-password',
        loadComponent: () =>
          import('./features/auth/forgot-password/forgot-password.component').then(
            (m) => m.ForgotPasswordComponent,
          ),
      },
      {
        path: 'reset-password',
        loadComponent: () =>
          import('./features/auth/reset-password/reset-password.component').then(
            (m) => m.ResetPasswordComponent,
          ),
        data: { mode: 'reset' },
      },
      { path: '', pathMatch: 'full', redirectTo: 'login' },
    ],
  },

  // ---- signed in --------------------------------------------------------
  {
    path: 'account',
    canActivate: [authGuard],
    children: [
      {
        path: 'verify-otp',
        loadComponent: () =>
          import('./features/auth/verify-otp/verify-otp.component').then(
            (m) => m.VerifyOtpComponent,
          ),
      },
      { path: '', pathMatch: 'full', redirectTo: '/dashboard' },
    ],
  },

  // ---- the app itself ------------------------------------------------------
  {
    path: '',
    canActivate: [authGuard, activeAccountGuard],
    component: TeacherLayoutComponent,
    children: [
      { path: 'dashboard', loadComponent: comingSoon, data: { title: 'Dashboard' } },
      {
        path: 'profile',
        loadComponent: () =>
          import('./features/teacher/profile/teacher-profile.component').then(
            (m) => m.TeacherProfileComponent,
          ),
        /*
          Nine sections, all of them holding typed text. canDeactivate asks the
          component what is dirty and names those sections in the warning — see
          unsavedChangesGuard for why it uses the native dialog.
        */
        canDeactivate: [unsavedChangesGuard],
        data: { title: 'My profile' },
      },
      { path: 'jobs', loadComponent: comingSoon, data: { title: 'Find jobs' } },
      { path: 'applications', loadComponent: comingSoon, data: { title: 'My applications' } },
      { path: 'saved-jobs', loadComponent: comingSoon, data: { title: 'Saved jobs' } },
      { path: 'invitations', loadComponent: comingSoon, data: { title: 'Invitations' } },
      { path: 'documents', loadComponent: comingSoon, data: { title: 'Documents' } },
      { path: 'notifications', loadComponent: comingSoon, data: { title: 'Notifications' } },
    ],
  },

  // ---- errors --------------------------------------------------------------
  {
    path: 'forbidden',
    loadComponent: () => import('jp-shared/pages').then((m) => m.ForbiddenComponent),
  },
  {
    path: '**',
    loadComponent: () => import('jp-shared/pages').then((m) => m.NotFoundComponent),
  },
];

/** Shared placeholder loader, until each feature lands. */
function comingSoon() {
  return import('jp-shared/pages').then((m) => m.ComingSoonComponent);
}
