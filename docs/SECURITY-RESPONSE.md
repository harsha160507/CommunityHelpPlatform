# Response to previously committed credentials

The original repository publicly tracked a populated .env file. This change removes it from the current tree and ignores future local environment files. This is not secret rotation and does not remove historical copies.

Before deploying:

1. Rotate the disclosed MySQL password at the actual database service, update the runtime configuration, and revoke old database access.
2. Reset every administrator account that may use the disclosed/default password. The upgrade disables legacy admins until explicit admin setup. Also change reused passwords outside this project.
3. The new server does not accept JWTs or JWT_SECRET; it uses random server-side sessions instead. Remove obsolete JWT configuration from the deployment and terminate any running old server version that still accepts it.
4. Invalidate any old application sessions, inspect the database and available service logs for unauthorized changes, and review public copies/forks where possible.
5. Decide whether to purge .env from Git history. Coordinate a history rewrite with collaborators, save a backup, and require fresh clones afterward. Do not rewrite history before credential rotation; copies may remain accessible elsewhere.
6. Supply production credentials only through the host's protected configuration store. Never put them in a report, issue, PR comment, screenshot or test fixture.
7. Enable appropriate GitHub secret scanning/push protection where available and the branch controls described in DEPLOYMENT.md.

These steps require access to your real database, hosting configuration or repository administration. The code change does not claim they have been performed.
