/**
 * Development environment for the teacher app.
 *
 * Replaced by environment.production.ts in a production build — see the
 * `fileReplacements` entry in angular.json.
 */
export const environment = {
  production: false,

  /** JP.Sso.Api — auth, users, roles, permissions, menus. */
  ssoApiUrl: 'http://localhost:5199/api',

  /** JP.App.Api — masters, approval engine, business endpoints. */
  appApiUrl: 'http://localhost:5299/api',

  /**
   * Refresh the access token this many seconds before it actually expires, so
   * a request is never sent with a token that dies in flight.
   */
  tokenRefreshLeewaySeconds: 60,

  /**
   * Where each kind of account belongs.
   *
   * Configured, not hardcoded: someone signing in to the wrong app is sent to
   * one of these, and a hardcoded production hostname in a local build would
   * send a developer straight to production.
   */
  appUrls: {
    admin: 'http://localhost:4200',
    school: 'http://localhost:4300',
    teacher: 'http://localhost:4400',
  },
};
