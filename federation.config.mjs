import { withNativeFederation, shareAll } from '@angular-architects/native-federation/config';

/*==============================================================================
  jp-teacher — a HOST. Loads everything shared from the jp-shared remote (:4999).

  🔴 `externals` is what makes a plain `import { UiButtonComponent } from
  'jp-shared/ui'` work.

  Native Federation has no "static remotes" mode: its documented API is the
  async loadRemoteModule(), which cannot feed a component's `imports: []` —
  Angular needs the class at component-definition time, not a promise. Listing
  the four specifiers here instead leaves them UNRESOLVED in the build output,
  and initFederation installs an import map whose keys are built as
  join(remoteName, exposeKey) — literally `jp-shared/ui`. The browser then
  resolves the bare specifier to the remote's bundle.

  So: TypeScript resolves these for types only (tsconfig paths); the browser
  resolves them for real, at runtime, from :4999.

  ⚠️ These four strings must match jp-shared's `name` + `exposes` keys exactly.
==============================================================================*/

export default withNativeFederation({
  name: 'jp-teacher',

  externals: ['jp-shared/ui', 'jp-shared/core', 'jp-shared/models', 'jp-shared/pages'],

  /**
   * 🔴 One Angular in the page, not two. Two copies means two InjectionToken
   * classes, two DI graphs and two copies of every service — a login that
   * succeeds while the shell still believes it is signed out. strictVersion
   * turns a mismatch into a load-time failure instead of that.
   */
  shared: {
    ...shareAll({
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
    }),
  },

  skip: ['rxjs/ajax', 'rxjs/fetch', 'rxjs/testing', 'rxjs/webSocket'],

  /**
   * 🔴 ignoreUnusedDeps must stay off in the hosts.
   *
   * It prunes the shared list by walking the import graph with Sheriff, and
   * Sheriff refuses any file outside the project root:
   *
   *   Error: D:\Projects\jp-shared\src\ui\...\ui-app-shell.component.ts
   *   is outside of root D:\Projects\jp-teacher
   *
   * The tsconfig `paths` mapping deliberately points at the sibling repo for
   * types, so that traversal always leaves this root and always fails.
   *
   * ⚠️ Turning it off has one knock-on effect: nothing prunes the unreachable
   * parts of a shared package any more, so esbuild bundles
   * `@angular/platform-browser`'s animations entry points, which import
   * `@angular/animations/browser`. That is why `@angular/animations` is a
   * dependency of this app despite no code using it. Removing it breaks the
   * build with "Could not resolve @angular/animations/browser", and `skip`
   * does NOT fix that — skip controls what is SHARED, not what resolves.
   */
  features: {
    ignoreUnusedDeps: false,
  },
});
