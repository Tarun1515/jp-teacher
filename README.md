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

All seven repositories are cloned as **siblings**:

```
D:Projects├── jp-docs      ← read this first
├── jp-shared    the shared library
├── jp-admin     :4200
├── jp-school    :4300
├── jp-teacher   :4400
├── jp-public    :4500
└── jp-backend   both APIs + all database scripts
```

New machine? `cd jp-docs && npm run bootstrap` clones and installs the lot,
then prints what still needs doing by hand.

---

## Setup

### 1. GitHub Packages token

`@tarun1515/jp-shared` is published to GitHub Packages, so installing it needs
a token with `read:packages`.

```bash
cp .npmrc.example .npmrc          # .npmrc is gitignored
setx GITHUB_TOKEN "ghp_..."       # PowerShell; reopen the shell afterwards
```

The token is read from the environment, so `.npmrc` itself never contains it.

> If npm reports **404** for `@tarun1515/jp-shared`, this is almost always the
> cause. GitHub Packages answers an unauthenticated request for a private
> package with 404 rather than 401, so "not found" usually means
> "not authorised".

### 2. Install

```bash
npm install
```

### 3. Shared library — pick a mode

**Development** (default while building anything). Points at the sibling working
copy; changes flow straight through, no version bump and no publish:

```bash
npm run link:shared
```

**Release** (CI, or another machine). Takes the published version:

```bash
npm run update:shared
```

Which mode am I in?

```bash
cd ../jp-docs && npm run check-versions
```

It prints `linked` or `installed` per app, and flags anything stale.

> ⚠️ This project sets **`"preserveSymlinks": true`** in `angular.json`.
> Do not remove it. Without it a linked library resolves its own copy of
> Angular, the app ends up with two, and every injection token fails with
> `NG0203: The InjectionToken JP_APP_IDENTITY token injection failed`. The
> message blames dependency injection; the cause is module resolution.

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

> `npm start` refuses to move to a different port if 4400 is busy. That is
> deliberate: the API's CORS allow-list and `environment.ts` are both pinned to
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
