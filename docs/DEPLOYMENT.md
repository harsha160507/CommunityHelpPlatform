# Deployment and maintenance

## Database installation

Create the database explicitly with utf8mb4. Create a dedicated migration account with database-scoped CREATE/ALTER/INDEX/REFERENCES and data permissions. Run `npm run migrate` once using that account. Migrations use a database advisory lock and a ledger; normal server startup never changes the schema.

Use a separate runtime account with SELECT/INSERT/UPDATE/DELETE on this application's tables and read access to the migration ledger. Production refuses a MySQL root account and an empty database password. Restrict MySQL to the application host/network. Use the database provider's encryption and certificate guidance for remote connections; the supplied connection defaults assume a private/local database.

The first migration creates the original tables if absent. The second adds review versions, lifecycle, attendance and account-security fields without dropping core rows. On upgrading the original schema, old admin accounts are disabled and all existing accounts start unverified. The third creates hashed sessions/tokens, mail outbox, notifications, idempotency records and audit tables. SQL DDL is not transactional in MySQL: take a backup before migration. If interrupted, rerun; CREATE IF NOT EXISTS and checked column/index additions are retryable. Inspect unusual partial/manual schema changes before retrying.

Set an explicit ADMIN_EMAIL and a unique ADMIN_PASSWORD of 12+ characters (up to 72 UTF-8 bytes), run `npm run admin:setup`, then remove these variables. The command resets an existing administrator only, revokes sessions, and refuses an email owned by a different role. It never runs automatically during server startup.

## Server and HTTPS

- Install dependencies with `npm ci --omit=dev`.
- Set NODE_ENV=production, a public HTTPS BASE_URL, EVENT_TIMEZONE and DB_* variables.
- Configure SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD and MAIL_FROM. Use SMTP_SECURE=true for implicit TLS (usually port 465), otherwise mandatory STARTTLS (usually 587). SMTP certificate validation remains enabled.
- Keep DEV_MAIL_PREVIEW off in production; production configuration rejects preview-only mail.
- Start with `npm start`. The default bind address is 127.0.0.1; set HOST only if your hosting platform requires another bind interface.
- Terminate HTTPS at a managed proxy that forwards to the loopback server. Set TRUST_PROXY=1 only with exactly one trusted reverse proxy, prevent direct access to the backend, and have that proxy overwrite untrusted forwarding headers. Otherwise leave TRUST_PROXY=0.
- Serve frontend and API from this same origin. Do not enable wildcard CORS or host the HTML separately without intentionally changing the deployment model.
- Helmet supplies response security headers and a restrictive content policy. Secrets, source files, database scripts and node_modules are outside the public frontend directory.
- /health/live is liveness; /health/ready verifies database schema access and returns 503 on failure. Configure readiness monitoring and alert on repeated 5xx, 429 and mail worker errors. Do not log Authorization headers or request bodies.
- Requests log method, path, status, duration and an opaque request ID as JSON. Email link tokens live in URL fragments and are not included in HTTP paths.
- SIGINT/SIGTERM stop new connections, stop the mail worker and close the pool, with a 20-second shutdown deadline.

## Email and notification operations

Account verification and password recovery use a transactional outbox with hashed, expiring, single-use tokens. The worker attempts one email every ten seconds, retries up to five times, removes message bodies after delivery, and deletes records older than a day. Link lifetime is 30 minutes. Monitor delivery failures; users can request a fresh link if a message expires. Do not enable development previews on a public server.

Approval, organizer/profile changes, cancellation and participation events appear in persistent **in-app** notifications. They do not currently generate bulk participant email. The overview polls every 30 seconds while visible; other views have Refresh to avoid replacing a form while it is being edited.

## Backup and recovery

Schedule encrypted MySQL logical backups of the complete application schema and test restores in a separate database. Example command, using a protected MySQL option file for credentials:

```sh
mysqldump --defaults-extra-file=/secure/mysql-backup.cnf --single-transaction --routines --triggers community_help > backup.sql
mysql --defaults-extra-file=/secure/mysql-restore.cnf community_help_restore < backup.sql
```

Keep credentials and dumps out of Git; restrict access because personal data and unexpired mail links may be present. Define retention and incident response appropriate to your deployment. After a restore, invalidate sessions and account links before allowing traffic; also clear pending outbox rows so old recovery messages are not replayed. Verify readiness, administrator access, roster ownership and event counts before cutover.

## Limits and owner settings

The initial deployment is a single API process with a process-local rate limiter and a small SMTP worker. Use shared rate limiting, monitored mail infrastructure, bounded audit retention and load testing before horizontal scaling or large campaigns.

Enable branch protection/rulesets in repository Settings after CI exists: require pull requests and green test jobs, block force pushes and deletion, and apply checks to administrators if appropriate. The connected GitHub tool can read these settings but cannot modify repository administration controls. Configure host secrets and deployments using the hosting service; no production account was accessed by this change.

An open-source license is an owner decision. LICENSE currently reserves rights rather than granting new rights over existing contributions.
