# jp-teacher

The Staffroom India app for **teachers**. Angular 22, standalone components,
runs on **http://localhost:4400**.

> 🔴 **Read `../jp-docs/PROJECT_MEMORY.md` before doing any work here.**
> `jp-docs` must be cloned as a sibling of this repository. It holds every
> locked architectural decision. It is deliberately not copied into any other
> repo — three copies become three versions within a week.

---

## Prerequisites

| | |
|---|---|
| Node.js | 22+ (Angular 22 needs 20.19+) |
| .NET SDK | 8.0.x — for `jp-backend` |
| SQL Server | 2019, instance `localhost\TARUN`, Windows auth |

## Setup

### 1. Install

```bash
npm install
```

No registry token, no `.npmrc`, no `npm link`. The shared code is not an npm
package any more — see the next section.

### 2. 🔴 jp-shared must be running

This app is a Module Federation **host**. `jp-shared` is a **remote** that
serves the design system and core services on **:4999**, and this app fetches
them at runtime.

```bash
cd ../jp-shared && npm start     # :4999 — leave it running
```

Start it **before** this app. Without it the app boots to a blank page, because
`jp-shared/ui`, `jp-shared/core`, `jp-shared/models` and `jp-shared/pages` are
import map entries pointing at :4999, not files on disk here.

That is the trade being made: one process everything depends on, in exchange
for editing a shared component and seeing it here on reload with no publish,
no version bump and no link step.

### 3. 🔴 The repos must be siblings

```
D:\Projects\
├── jp-docs      ← read PROJECT_MEMORY.md first
├── jp-shared    :4999   the remote — start this first
├── jp-admin     :4200
├── jp-school    :4300
├── jp-teacher   :4400
├── jp-public    :4500   standalone, not federated
└── jp-backend   both APIs + all database scripts
```

Not just a convention. **JavaScript is shared at runtime** over federation, but
**SCSS is shared at build time**, through `angular.json`:

```json
"stylePreprocessorOptions": { "includePaths": ["../jp-shared/src/styles"] }
```

That `../` is why the checkout layout is load-bearing. Components keep writing
`@use 'variables' as v;` exactly as before — no relative paths, no copies.

> ⚠️ **CI must check out `jp-shared` beside this repo**, or the build fails at
> the first component stylesheet. A build agent that clones only this
> repository cannot compile it.

New machine? `cd jp-docs && npm run bootstrap` clones and installs all seven,
then prints what still needs doing by hand.

### 4. Two gotchas worth knowing before you hit them

**Do not run a production build while the dev server is running.** Both share
the federation externals cache, and a production build replaces the dev copy of
`@angular/core`. The app then dies with `ReferenceError: ngDevMode is not
defined`, which says nothing about the cause. Fix: stop the dev server, delete
`.angular/cache`, start again.

**`@angular/animations` is a dependency and no code uses it.** Leave it. The
hosts turn off Native Federation's `ignoreUnusedDeps`, so nothing prunes the
unreachable parts of `@angular/platform-browser`, whose animations entry points
import it. Removing it breaks the build with `Could not resolve
@angular/animations/browser`.

---

## Running

```bash
npm start              # http://localhost:4400
npm run build:prod
```

You also need `JP.Sso.Api` on :5199 from `jp-backend`:

```bash
cd ../jp-backend/JP.Sso.Api && dotnet run
```

> `npm start` refuses to move to a different port if the port is busy. That is
> deliberate: the API CORS allow-list and `environment.ts` are both pinned to
> it, so on any other port the app loads and then every request fails. Stop
> whatever is holding the port rather than moving off it.

---

## Screens

- Sign in, and teacher signup (single-purpose — no user-type toggle)
- Forgot password, reset password, OTP verification
- Teacher shell

⚠️ Teachers are mostly on phones. 375px is the primary experience here, not a
responsive afterthought.

---

## Signing in

Only **teacher accounts** work here. All the apps authenticate against the
same SSO API, so an administrator or school **can** sign in successfully — valid token, wrong
app. When that happens this app signs them straight back out and names where
they should go, with a link.

That check runs after login and again at bootstrap, because a token can also
arrive from storage. It is **wayfinding, not security**: the token stays valid
and the server is what actually enforces access.
