# @projectos/server — organization control plane (A0 PoC)

**Status: isolated A0 technical proof. Not production, not deployed, not wired to the desktop UI.**

This package answers one question with real code: *does better-auth + Fastify + organization scoping +
a secure desktop loopback/PKCE login actually work on this stack?* The answer is exercised by two real
integration test files that open a real TCP port, talk to the real better-auth handler and the real
loopback listener.

## What this PoC proves

- **better-auth runs inside Fastify 5.** `apps/server/src/app.ts` converts a Fastify request into a
  Web `Request`, calls `auth.handler(req)`, and copies status, headers (including multiple
  `set-cookie`) and body back. Sign-up, sign-in, and the organization plugin endpoints are reached
  over HTTP at `/api/auth/*`.
- **Organization membership is data, not a URL.** `membershipFor(accountId, orgId)` reads the member
  rows better-auth's organization plugin wrote (`createAuthDirectory` in `app.ts`). A caller cannot
  get access by putting someone else's organization id in the path.
- **Organization role ≠ project permission.** Organization routes use `canOrg`, project routes use
  `assertProjectAccess`; an invited `member` can read organization projects but not create one, and
  still has no access to a project they are not a member of (`PROJECT_FORBIDDEN`).
- **Desktop login is loopback + PKCE with a one-time code.** The login/consent pages are
  server-rendered HTML with a strict CSP, no JavaScript, `X-Frame-Options: DENY` and
  `Cache-Control: no-store`. Only a one-time code (120 s TTL, single use) appears in the redirect
  URL; the opaque bearer token (32 random bytes, 8 h) never does.
- **Consent is explicit.** A separate one-time consent id (10 min TTL, bound to the signed-in
  account) gates code issuance; the page states what is *not* granted (no local files, shell, Git
  push or Worker lease).

## What this deliberately is NOT

- No PostgreSQL, no Drizzle, no migrations. Accounts, organizations, projects and requirements live
  in a per-process memory adapter / arrays and disappear on restart.
- No production deployment, no TLS, no reverse proxy, no rate limiting (`rateLimit.enabled = false`),
  no persistent secret management (a development fallback secret is used when
  `BETTER_AUTH_SECRET` is absent).
- No Electron IPC/preload wiring, no `safeStorage` token persistence, no UI. `apps/desktop` only gets
  the dependency-injected loopback core (`src/main/auth/desktop-login-core.ts`); nothing calls it yet.
- No real OAuth/OIDC client. The desktop flow is modelled on OAuth 2.1 native-app guidance but the
  "client" is first-party and hard-coded to `projectos-desktop`.
- No refresh tokens, revocation list, audit trail or token hashing at rest.

## Files

| File | Purpose |
| --- | --- |
| `src/app.ts` | `buildServer()`: memory DB, better-auth mount, `/api/auth/*` bridge, organization/project routes, `membershipFor` directory |
| `src/desktop-auth.ts` | `/v1/desktop/authorize` (GET/POST), `/v1/desktop/consent`, `/v1/desktop/token`, `/v1/me`, consent/code/token tables |
| `src/store.ts` | A0 in-memory project/requirement store (arrays + explicit tenant columns); clearly marked as replaceable in A1/A2 |
| `src/index.ts` | Entry point: listen on `127.0.0.1:PORT`, log the URL, graceful shutdown |
| `../../tests/org-server-poc.test.ts` | Real-HTTP integration: sign-up, organizations, scoping, invitation, desktop flow, PKCE/code reuse |
| `../../tests/org-desktop-login.test.ts` | `runDesktopLogin` against the real server with a fetch-driven fake browser; timeout, state mismatch, Host spoofing, cleanup |

## Run

```bash
# from the repository root
pnpm install                                  # already done for this PoC
pnpm vitest run tests/org-server-poc.test.ts tests/org-desktop-login.test.ts

# start the PoC server (tsx, in-memory data resets every start)
pnpm --filter @projectos/server dev

# build + smoke the bundled entry
pnpm --filter @projectos/server build
PORT=4311 node apps/server/dist/index.js
```

Environment variables:

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4310` | Listens on `127.0.0.1` only |
| `BETTER_AUTH_URL` | `http://127.0.0.1:${PORT}` | Must match the browser-visible origin, otherwise better-auth rejects POSTs with `INVALID_ORIGIN` |
| `BETTER_AUTH_SECRET` | development fallback | **A deployment must set this**; the fallback is intentionally not production-safe |

Packaging note: the tsup bundle externalizes the workspace `@projectos/organization-contracts`
package, whose `exports` point at TypeScript source. It runs on Node 24 because Node executes `.ts`
via type stripping; a deployment Node without that behavior (or a publish-only artifact) must build
the contracts package to JavaScript first. That is an A0 packaging gap, not an auth gap.

## HTTP surface

| Method + path | Credential | Behavior |
| --- | --- | --- |
| `/api/auth/*` | browser session cookie | better-auth (sign-up/sign-in, `organization/{create,list,invite-member,accept-invitation}`, …) |
| `GET /v1/desktop/authorize` | session cookie (optional) | Login page or consent page; validates the desktop query with `DesktopAuthorizeQuerySchema` |
| `POST /v1/desktop/authorize` | form + session | `signInEmail({ asResponse: true })`, forwards `Set-Cookie`, 302 back to the authorize URL |
| `POST /v1/desktop/consent` | form + session | One-time consent id → one-time authorization code (120 s) → 302 `redirect_uri?code&state` |
| `POST /v1/desktop/token` | JSON code + verifier | PKCE S256 check, code consumed once, opaque bearer token (8 h) returned as `DesktopSession` |
| `GET /v1/me` | `Bearer` token | account + organizations (roles read from better-auth data) |
| `GET /v1/organizations/:orgId/projects` | `Bearer` token | 200 for active org members, 403 `ORG_FORBIDDEN` otherwise |
| `POST /v1/organizations/:orgId/projects` | `Bearer` token | additionally requires `org.create_project` |
| `GET /v1/projects/:projectId/requirements` | `Bearer` token | requires `project.view` via `assertProjectAccess`, else 403 `PROJECT_FORBIDDEN` |
| `POST /v1/projects/:projectId/requirements` | `Bearer` token | requires `project.write_requirement`; added so tests can seed through the public API and prove write scope |
| `GET /health` | none | Liveness only |

Domain failures use `{ error: { code, message } }` with the contract codes `ORG_FORBIDDEN`,
`PROJECT_FORBIDDEN`, `RESOURCE_NOT_IN_SCOPE`. Transport/auth-layer failures that have no contract
code use `invalid_request` (400), `invalid_grant` (400), `UNAUTHENTICATED` (401) and `NOT_FOUND`
(404); they are not presented as domain codes.

## Security notes

- Callback listener binds **127.0.0.1 only**, validates the `Host` header (`127.0.0.1:<port>`) and
  the `/callback` path, handles a single terminal callback, always closes, and times out.
- `state`, PKCE S256, one-time codes and one-time consent ids are all enforced; a failed PKCE check
  consumes the code (no verifier brute-force oracle).
- The login page never echoes the password, and a failed sign-in is reported without distinguishing
  "unknown account" from "wrong password".
- The bearer token is opaque (no user data embedded) and grants only organization/project scope
  checks; it grants no local filesystem, shell, Git push or Worker lease.
- PoC-only weaknesses an A1 reviewer must not ship: tokens are held unhashed in process memory, there
  is no rate limiting, no refresh/revocation, cookies are `SameSite=Lax` without `Secure` on http,
  and the development secret fallback exists.

## Deviations / decisions vs. the original task text

- `buildServer` is `async` (returns `Promise<FastifyInstance>`) because `better-auth` initialization
  is synchronous but the tests need to `await` a uniform builder; the signature is otherwise as
  specified (`{ secret?, baseURL? }`).
- The better-auth 1.7.14 memory adapter is used as `database: memoryAdapter(db)` where `db` is the
  explicit model map (`user`, `session`, `account`, `verification`, `organization`, `member`,
  `invitation`). The installed adapter throws on an unknown model, so the map is explicit rather
  than lazily populated. No API adaptation was needed.
- Rate limiting and telemetry are explicitly disabled so integration tests are deterministic and the
  PoC makes no outbound network call.
- Tests reserve an ephemeral loopback port before `buildServer({ baseURL })` and then bind it, because
  better-auth's `trustedOrigins` must equal the actual origin; the tests send realistic `Origin`
  headers and a mismatched origin would correctly be rejected with `INVALID_ORIGIN`.
- The "state mismatch is rejected by the loopback core" assertion lives in
  `tests/org-desktop-login.test.ts`, because the loopback core is a desktop-side component; the server
  test file asserts that the callback carries exactly `code` + `state` and that PKCE mismatch/code
  reuse are rejected by the server.
- Two small routes were added beyond the listed set (`POST /v1/projects/:projectId/requirements`,
  `GET /health`) to keep tests on the public API and to prove write scope; both are documented above.
- A "deny" decision on the consent page redirects to `redirect_uri?error=access_denied&state=…`
  instead of returning HTML, matching the OAuth-style error convention. No test depends on it.

## A1 migration plan

1. **Persistence.** Replace the memory adapter and `store.ts` arrays with PostgreSQL + Drizzle:
   `drizzleAdapter(db, { provider: 'pg' })` for better-auth tables, real `organizations`, `members`,
   `invitations`, `projects`, `project_memberships`, `requirements` tables with foreign keys, plus
   migrations. Enforce tenant scope in SQL (including RLS) and in the repository layer.
2. **Tokens and sessions.** Store only a SHA-256 hash of bearer tokens with `expiresAt`,
   `revokedAt`, `deviceId`; add rotation/revocation and an audit record for each consent grant.
3. **Real OAuth client.** Register the desktop client with an allowed redirect-URI list
   (`http://127.0.0.1:<ephemeral>/callback` only), short code TTL, and server-side rate limiting for
   `/v1/desktop/token` and sign-in.
4. **Electron wiring.** Call `runDesktopLogin({ authBaseUrl, openExternal: shell.openExternal })` from
   the main process, keep the token in `safeStorage`, expose typed IPC/preload methods only, and add a
   "sign out / revoke this device" path.
5. **Hardening.** Remove the development secret fallback, require HTTPS in non-loopback deployments,
   set `Secure` cookies, add CSRF/origin review for the real origin, and add an authenticated
   `GET /v1/me` rate-limit + audit trail.
6. **Verification.** Re-run these two test files against the PostgreSQL adapter (they should stay
   unchanged), then add packaged-Electron E2E for the real browser handoff.
