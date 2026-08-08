import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import {
  JP_API_CONFIG,
  JP_APP_IDENTITY,
  JpAppIdentity,
  UserType,
  authInterceptor,
  errorInterceptor,
  loaderInterceptor,
} from '@tarun1515/jp-shared';

import { environment } from '../environments/environment';
import { routes } from './app.routes';

/**
 * Who this app is, for the shared library.
 *
 * `key` prefixes browser storage so a token written here is never read by a
 * sibling app sharing an origin. `userType` is what AppAccessService checks a
 * token's utype claim against.
 */
const identity: JpAppIdentity = {
  key: 'teacher',
  userType: UserType.Teacher,
  label: 'the teacher portal',
  destinations: environment.appUrls,
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),

    { provide: JP_APP_IDENTITY, useValue: identity },
    {
      provide: JP_API_CONFIG,
      useValue: {
        ssoApiUrl: environment.ssoApiUrl,
        appApiUrl: environment.appApiUrl,
        tokenRefreshLeewaySeconds: environment.tokenRefreshLeewaySeconds,
      },
    },

    provideRouter(
      routes,
      // Lets a route param bind straight to a component input.
      withComponentInputBinding(),
      // Land at the top on navigation, and restore position on back.
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),

    provideHttpClient(
      /*
       * ORDER MATTERS.
       *
       * A request travels down this list and the response comes back up it:
       *
       *   request   loader -> error -> auth -> server
       *   response  loader <- error <- auth <- server
       *
       * So auth sees a 401 first and gets its chance to refresh the token and
       * retry silently. Only a 401 it could not recover from carries on to
       * error, which reports it. Loader is outermost, so the spinner clears
       * after everything else has finished — including a retried request.
       *
       * Putting error before auth would show the user a "session expired"
       * toast for every refresh that was about to succeed.
       */
      withInterceptors([loaderInterceptor, errorInterceptor, authInterceptor]),
    ),
  ],
};
