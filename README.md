# Community Help Platform

A Node.js/MySQL application for discovering community events, reviewing NGO registrations, and coordinating volunteers. Guests can browse approved upcoming opportunities. NGOs submit events for review; volunteers register, withdraw and track changes.

## Project layout

```text
backend/
  src/
    app.js              HTTP application, security middleware, public endpoints
    server.js           Startup, mail worker and graceful shutdown
    config.js           Validated environment settings
    db.js               MySQL pool and transaction boundary
    validation.js       Shared server input and timezone rules
    middleware.js       Revocable session authentication and roles
    services.js         Notifications, audit entries and account mail
    pagination.js       Bounded collection responses
    routes/             Account, admin, event and volunteer routes
  scripts/              Migrations, explicit admin setup and dev mail preview
database/migrations/     Versioned schema changes; existing core data is retained
frontend/                Same-origin HTML, JavaScript and CSS
tests/                   Unit, real-MySQL integration and browser/accessibility tests
scripts/                 Source/import validation
docs/                    API, deployment, security response and fix report
.github/                 CI, dependency updates and issue templates
```

## Requirements

- Node.js 22.13+, 24 or 26.
- MySQL 8.0+ with InnoDB. The application database must already exist.
- A local development browser; production also requires HTTPS and SMTP.

## Local setup

1. Create a MySQL database and a dedicated account. Use an administrator connection to create `community_help` with `utf8mb4`, then grant the application account access to that database. Do not run the production server as MySQL root.
2. Run `npm ci`.
3. Copy `.env.example` to `.env` and set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_NAME`. Generate unique credentials. Never commit `.env`.
4. Set `BASE_URL=http://localhost:3000` and your event timezone, for example `EVENT_TIMEZONE=Asia/Kolkata`.
5. Run `npm run migrate` using a database account with schema permissions.
6. Supply a unique `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` in the local environment, then run `npm run admin:setup`. There are no default admin credentials. Remove these two bootstrap variables afterward.
7. Run `npm start` and open [http://localhost:3000](http://localhost:3000). Do not open the HTML file directly.

The same server serves the UI and `/api`. API hosts and ports are not hardcoded in the browser. `npm run dev` restarts the server when backend files change.

In development only, `DEV_MAIL_PREVIEW=true` queues verification/reset messages without sending email. Run `npm run mail:preview` locally to read links. Anyone who can read the development database can read those links. Production refuses this mode and requires SMTP.

## Account and event rules

- All accounts verify their email. Volunteers are then active immediately; NGOs also need administrator approval.
- Passwords require at least 12 characters and no more than 72 UTF-8 bytes, matching bcrypt's input boundary.
- Sessions expire after 12 hours and are revoked by logout, password changes/resets and account disabling. Tokens are stored hashed in MySQL; the browser keeps its token in tab-scoped session storage.
- Events use a calendar date, a same-day start/end time and one configured IANA timezone. Dates stay `YYYY-MM-DD` strings. Nonexistent/ambiguous daylight-saving times are rejected.
- Events must start in the future and have capacity 1–10,000. Joining closes at the start time.
- Public lists and counts require an approved, active organizer, an approved scheduled event, and a future start. Capacity is checked in a transaction during joining.
- Profile edits by an NGO trigger NGO re-review. Event edits trigger event re-review and cannot reduce capacity below existing registrations.
- Admin decisions require the current version/status and a reason for rejection. Decisions and user actions are recorded; affected users get persistent in-app activity messages.
- Cancellation and approval revocation are visible in existing registrations. Volunteers may withdraw from cancelled/unavailable events. Completed attendance is retained.
- Only the organizer can see participant contact details and record attendance after completion. Registration shares these details with the organizer.
- Profile deletion removes identity fields, cancels scheduled NGO events and revokes sessions. Historical event/audit records remain. Administrator deletion is an owner-managed operation.
- Email addresses are immutable through the profile form. Use account recovery or contact the operator for identity corrections.

## Checks

```sh
npm run check
npm run lint
npm run format:check
npm test
npm audit --audit-level=high
```

For database tests, create a **disposable** database whose name ends in `_test`, configure its connection using the `DB_*` environment variables and set `ALLOW_TEST_DB_RESET=1`. Then:

```sh
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

Integration tests **erase all tables in that test database** before checking migration compatibility, authorization, race conditions, availability and account flows. Browser tests reuse that schema and add fixtures; run them after integration tests. They start a test server on loopback port 33418. Never point tests at a real community database.

CI runs the checks with MySQL and supported Node versions. Browser tests include automated desktop/mobile accessibility checks; they are not a substitute for assistive-technology user testing.

## Deployment and upgrading

Read [deployment](docs/DEPLOYMENT.md) before deploying. Existing users must verify their email after this upgrade; legacy administrator accounts are disabled until explicitly reset using `admin:setup`. Existing JWTs are no longer accepted.

**Previously committed credentials must be rotated at their actual services.** Removing the tracked file does not erase Git history or rotate a deployed database password. Follow [the incident response steps](docs/SECURITY-RESPONSE.md).

See [the fix report](docs/FIX-REPORT.md) for all 36 audit findings, implemented changes and remaining owner actions, and [API documentation](docs/API.md) for the new endpoint contract.

## Licensing

[LICENSE](LICENSE) reserves project rights pending an owner-selected distribution license. Dependencies retain their own licenses. This change does not silently grant an open-source license over existing contributors' work.
