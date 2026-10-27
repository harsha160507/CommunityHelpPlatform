# Contributing

Use supported Node.js and MySQL versions from README.md. Branch from main, keep unrelated changes separate, and use a pull request. Never commit environment files, database dumps, personal information or real credentials.

Run source/import checks, lint, formatting, unit tests and integration tests before opening a PR. Use a dedicated *_test database with ALLOW_TEST_DB_RESET=1; integration tests erase its tables. Run browser tests after integration tests.

Describe the user-visible problem, resulting behavior, database changes and checks performed. Preserve existing records with versioned migrations. Authorization and eligibility belong on the server; client checks are for feedback. Preserve idempotency and transaction locking when changing participation.

Report a security issue privately using the repository owner's GitHub contact options rather than publishing secrets in a public issue. See SECURITY.md.
