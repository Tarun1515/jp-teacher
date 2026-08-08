import { initFederation } from '@angular-architects/native-federation';

/**
 * 🔴 Nothing may be statically imported here except initFederation.
 *
 * An import map only governs modules loaded after it is installed. Anything
 * imported at the top of this file is evaluated before initFederation runs and
 * therefore escapes the map — which is exactly how a second copy of
 * @angular/core ends up in the page. The real entry point is ./bootstrap,
 * imported dynamically once the map exists.
 *
 * The manifest is read at runtime rather than compiled in, so the remote's URL
 * is a deployment concern: replace public/federation.manifest.json per
 * environment and nothing has to be rebuilt.
 */
initFederation('/federation.manifest.json')
  .catch((err) => console.error(err))
  .then(() => import('./bootstrap'))
  .catch((err) => console.error(err));
