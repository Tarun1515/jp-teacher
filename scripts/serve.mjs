#!/usr/bin/env node
/*==============================================================================
  `npm start` — ng serve with a NON-NEGOTIABLE port (4400).

  Pinning `port` in angular.json is necessary but NOT sufficient. When the port
  is busy, @angular/build's checkPort does this:

      not a TTY  -> reject: "Port 4400 is already in use."
      a TTY      -> prompt: "Would you like to use a different port?"
                    ...with `default: true`, and on yes it calls checkPort(0),
                    which asks the OS for ANY free port.

  So in a real terminal, a stale server plus one press of Enter silently serves
  this app on an ephemeral port. That is not cosmetic: decision 2.17 pins these
  ports, and both APIs' CORS allow-lists and every environment.ts are wired to
  them. On any other port the app loads and then every API call fails — a far
  more confusing failure than a refusal to start.

  With four apps a stale dev server is the normal case, not the unlucky one.

  NG_FORCE_TTY=0 makes isTTY() return false, so the prompt never appears and a
  busy port is a hard error with a clear message.
==============================================================================*/

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ng = resolve(here, '..', 'node_modules', '@angular', 'cli', 'bin', 'ng.js');

const child = spawn(process.execPath, [ng, 'serve', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NG_FORCE_TTY: '0' },
});

// Forward the child's fate rather than always exiting 0 — CI needs the real
// exit code, and Ctrl-C needs to look like Ctrl-C.
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
