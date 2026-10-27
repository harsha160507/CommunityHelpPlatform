<div align="center">

<h1>🤝 Community Help Platform</h1>

<p><strong>Where local causes become collective action.</strong></p>

<p>Discover a cause. Organize an opportunity. Bring people together.<br>A community platform connecting volunteers, NGOs, and the people who support them.</p>

<p>
  <a href="https://github.com/harsha160507/CommunityHelpPlatform/actions/workflows/ci.yml"><img src="https://github.com/harsha160507/CommunityHelpPlatform/actions/workflows/ci.yml/badge.svg?branch=main" alt="Continuous integration status"></a>
  <img src="https://img.shields.io/badge/Node.js-22.13%2B%20%7C%2024%20%7C%2026-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22.13+, 24 or 26">
  <img src="https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white" alt="Express 4">
  <img src="https://img.shields.io/badge/MySQL-8.0%2B-4479A1?logo=mysql&logoColor=white" alt="MySQL 8.0 or later">
</p>

<p>
  <a href="#features">Explore features</a> ·
  <a href="#system-architecture">Architecture</a> ·
  <a href="#data-flow-diagrams">Data flow</a> ·
  <a href="#use-case-diagrams">Use cases</a> ·
  <a href="#getting-started">Run locally</a> ·
  <a href="#documentation">Documentation</a>
</p>

</div>

---

## The idea

Good intentions need a place to become action. **Community Help Platform** gives NGOs a way to organize local events, volunteers a way to find opportunities, and administrators a way to review what is published.

The result is one connected journey: **discover → review → participate → follow through**.

| For volunteers                                        | For NGOs                                                                      | For administrators                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Find approved opportunities and choose where to help. | Turn community needs into events with clear capacity and participant records. | Review submissions, provide feedback, and keep a traceable history of decisions. |

## Features

|                                  | What you can do                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 🔎 **Discover opportunities**    | Browse approved upcoming events and the NGO directory, even before creating an account.                  |
| 🏢 **Organize community events** | Create events, set volunteer capacity, submit changes for review, and manage cancellation or completion. |
| 🙌 **Take part**                 | Register for an event, withdraw when plans change, and follow the status of your registrations.          |
| ✅ **Review with context**       | Inspect NGO and event details, approve or reject requests, and provide clear review feedback.            |
| 📋 **Coordinate volunteers**     | View organizer-only participant rosters and record attendance after an event is completed.               |
| 🔔 **Stay informed**             | Receive persistent in-app updates about participation, review decisions, and event changes.              |
| 🔐 **Manage your account**       | Verify your email, recover or change your password, update your profile, and delete your account.        |
| 📊 **See the bigger picture**    | View community counts, personal activity, and administrator review history with paginated lists.         |

### A role for everyone

| Role              | Main capabilities                                                                |
| ----------------- | -------------------------------------------------------------------------------- |
| **Guest**         | Explore approved NGOs and upcoming events.                                       |
| **Volunteer**     | Join or withdraw from events, track registrations, and manage an account.        |
| **NGO**           | Submit events, manage participants, update event details, and record attendance. |
| **Administrator** | Review NGOs and events, manage volunteer access, and inspect action history.     |

## System architecture

A browser-based frontend and an Express API share one origin. MySQL stores application records, while a background worker sends verification and recovery email through SMTP.

### Component architecture

```mermaid
flowchart TB
    accTitle: Community Help Platform system architecture
    accDescr: Browser users access one Express application serving the frontend and API. Protected routes use current sessions and role checks. Domain services and an in-process email worker share one MySQL database. Only the email worker connects to the external SMTP provider.

    Users["Guest · Volunteer · NGO · Administrator"]
    Browser["Browser interface<br/>HTML · CSS · JavaScript<br/>frontend/"]

    subgraph Application["Node.js application · one running process"]
        Web["Express server<br/>Static frontend files + /api"]
        Routes["Request middleware and routes<br/>Accounts · Administration · Events · Volunteers"]
        Services["Application services<br/>Validation · Transactions · Notifications · Audit"]
        Worker["Background email worker<br/>server.js timer → mail.js<br/>Checks the outbox every 10 seconds"]
    end

    Database[("MySQL application database<br/>Accounts · Sessions · Verification/reset tokens<br/>Events · Participants · Activity · Audit<br/>Mail outbox · Submission keys")]
    SMTP["External SMTP provider<br/>Verification and recovery email"]

    Users --- Browser
    Browser <-->|"Same-origin requests / responses"| Web
    Web <-->|"API requests / JSON results"| Routes
    Routes <-->|"Validated operations / results"| Services
    Services <-->|"mysql2 pool: SQL / records"| Database
    Database <-->|"Queued account mail / send state"| Worker
    Worker <-->|"SMTP over TLS / send response"| SMTP

    classDef user fill:#eff6ff,stroke:#2563eb,color:#172554
    classDef app fill:#ecfdf5,stroke:#059669,color:#064e3b
    classDef store fill:#fff7ed,stroke:#ea580c,color:#7c2d12
    classDef external fill:#faf5ff,stroke:#9333ea,color:#581c87
    class Users,Browser user
    class Web,Routes,Services,Worker app
    class Database store
    class SMTP external
```

**One application, two execution paths:** browser requests pass through the Express routes and application services; the email worker reads the same database's outbox independently. Both run in the **same Node.js process**, using one shared MySQL connection pool.

- **Frontend:** Express serves the HTML, CSS, and JavaScript; the browser calls the same origin's `/api` endpoints.
- **API:** input validation, current-session checks, role permissions, and domain rules protect the relevant operations. Public discovery remains available without login.
- **Database:** transactions persist accounts, sessions, events, enrollment, activity, and queued account email.
- **Email worker:** a ten-second timer processes verification/recovery mail through SMTP and records send attempts. Development mail preview replaces SMTP sending.
- **Activity:** personal notifications are stored in MySQL and read through the API; the overview refreshes every 30 seconds while visible.

[Editable architecture source](docs/diagrams/system-architecture.mmd) · [Component and process guide](docs/SYSTEM-DESIGN.md#system-architecture)

### Layer responsibilities

| Layer              | Responsibility                                                                     | Implementation                                             |
| ------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Presentation**   | Public discovery, account screens, event management, and role-based dashboards.    | HTML, CSS, JavaScript in `frontend/`.                      |
| **Application**    | Authentication, role checks, validation, reviews, enrollment, and permitted views. | Express routes and services in `backend/src/`.             |
| **Persistence**    | Accounts, hashed sessions/tokens, events, participants, activity, and queued mail. | MySQL with versioned migrations in `database/migrations/`. |
| **Email delivery** | Read queued account messages, send through SMTP, and record retries or acceptance. | `backend/src/mail.js`.                                     |

The diagrams below describe the implemented project. The [system-design guide](docs/SYSTEM-DESIGN.md) maps processes to code, explains the data stores, and records the diagram boundaries.

## Data flow diagrams

Read these diagrams as **data moving between people, processes, and stores**. Process numbers remain consistent between levels; they are not execution-step numbers.

**Legend:** blue rectangles = external actors · green nodes = processes · orange cylinders = logical data stores. A two-headed link abbreviates read/write or request/response flows named on that link.

### Level 0 — The platform in its environment

The context diagram treats the entire application as one process. It shows what guests, volunteers, NGOs, administrators, and the SMTP provider exchange with it.

```mermaid
flowchart LR
    accTitle: Level 0 data-flow diagram - system context
    accDescr: Guests, volunteers, NGOs and administrators exchange requests and results with the platform. The SMTP provider exchanges account emails and delivery responses.
    G["Guest"]
    V["Volunteer"]
    N["NGO"]
    A["Administrator"]
    S(("0<br/>Community Help<br/>Platform"))
    M["SMTP provider"]

    G -->|"Discovery and signup requests"| S
    S -->|"Public listings and signup results"| G
    V -->|"Account and participation requests"| S
    S -->|"Account results and activity"| V
    N -->|"Profile and event requests"| S
    S -->|"Review feedback and rosters"| N
    A -->|"Review and access decisions"| S
    S -->|"Review results and history"| A
    S -->|"Account emails"| M
    M -->|"Send acceptance or failure"| S

    classDef actor fill:#eff6ff,stroke:#2563eb,color:#172554
    classDef process fill:#ecfdf5,stroke:#059669,color:#064e3b
    class G,V,N,A,M actor
    class S process
```

### Level 1 — The five platform processes

The context process expands into account management, moderation/event lifecycle, enrollment, discovery/permitted views, and email delivery.

The panels reuse the **same D1–D5 stores** for readability; repeated store labels are references to shared records, not separate databases. Actor labels identify possible callers—each operation still enforces its own role permissions.

```mermaid
flowchart TB
    accTitle: Level 1 data-flow diagram - five platform processes
    accDescr: Five process panels reuse store identifiers for the same shared database records. Portal actor requests and responses connect to accounts, event management, enrollment, and discovery. The mail process exchanges messages with SMTP.

    subgraph L1["1.0 · Accounts and sessions"]
        direction LR
        U1["Guest / Volunteer / NGO / Admin"]
        P1("1.0<br/>Manage accounts<br/>and sessions")
        D1a[("D1 · Accounts and access")]
        D4a[("D4 · Activity and audit")]
        D5a[("D5 · Mail outbox")]
        U1 <-->|"Account requests / results"| P1
        P1 <-->|"Profiles, sessions, tokens"| D1a
        P1 -->|"Account activity"| D4a
        P1 -->|"Account email payloads"| D5a
    end

    subgraph L2["2.0 · Moderation and event lifecycle"]
        direction LR
        U2["NGO / Volunteer / Admin"]
        P2("2.0<br/>Review accounts and<br/>manage event lifecycle")
        D1b[("D1 · Accounts and access")]
        D2b[("D2 · Events and request keys")]
        D3b[("D3 · Participants")]
        D4b[("D4 · Activity and audit")]
        U2 <-->|"Review, event and participation changes / results"| P2
        P2 <-->|"Account review and access state"| D1b
        P2 <-->|"Event records and submission keys"| D2b
        P2 <-->|"Counts, withdrawal, attendance"| D3b
        P2 -->|"Review and event notices"| D4b
    end

    subgraph L3["3.0 · Volunteer enrollment"]
        direction LR
        U3["Volunteer"]
        P3("3.0<br/>Register volunteer<br/>for an event")
        D1c[("D1 · Accounts and access")]
        D2c[("D2 · Events and request keys")]
        D3c[("D3 · Participants")]
        D4c[("D4 · Activity and audit")]
        U3 <-->|"Join request / enrollment result"| P3
        D1c -->|"Current user and organizer"| P3
        D2c -->|"Event eligibility"| P3
        P3 <-->|"Membership and capacity data"| D3c
        P3 -->|"Participation notice and audit"| D4c
    end

    subgraph L4["4.0 · Discovery and permitted views"]
        direction LR
        U4["Guest / Volunteer / NGO / Admin"]
        P4("4.0<br/>Provide discovery,<br/>rosters and activity")
        D1d[("D1 · Accounts and access")]
        D2d[("D2 · Events and request keys")]
        D3d[("D3 · Participants")]
        D4d[("D4 · Activity and audit")]
        U4 <-->|"View queries / permitted data"| P4
        D1d -->|"NGOs, identities and access context"| P4
        D2d -->|"Event details and status"| P4
        D3d -->|"Membership, counts and attendance"| P4
        D4d -->|"Personal activity and audit history"| P4
    end

    subgraph L5["5.0 · Account email delivery"]
        direction LR
        D5b[("D5 · Mail outbox")]
        P5("5.0<br/>Deliver queued<br/>account email")
        M["SMTP provider"]
        D5b <-->|"Queued messages / send state"| P5
        P5 <-->|"Email payload / send response"| M
    end

    L1 ~~~ L2 ~~~ L3 ~~~ L4 ~~~ L5

    classDef actor fill:#eff6ff,stroke:#2563eb,color:#172554
    classDef process fill:#ecfdf5,stroke:#059669,color:#064e3b
    classDef store fill:#fff7ed,stroke:#ea580c,color:#7c2d12
    class U1,U2,U3,U4,M actor
    class P1,P2,P3,P4,P5 process
    class D1a,D1b,D1c,D1d,D2b,D2c,D2d,D3b,D3c,D3d,D4a,D4b,D4c,D4d,D5a,D5b store
```

| Store                            | Records represented                                           |
| -------------------------------- | ------------------------------------------------------------- |
| **D1 · Accounts and access**     | `chp_users`, `chp_sessions`, `chp_account_tokens`.            |
| **D2 · Events and request keys** | `chp_events`, `chp_event_requests`.                           |
| **D3 · Participants**            | `chp_event_participants`, including attendance.               |
| **D4 · Activity and audit**      | `chp_notifications`, `chp_audit_log`.                         |
| **D5 · Mail outbox**             | `chp_mail_outbox`, including send attempts and message state. |

### Level 2 — Inside volunteer enrollment

This level decomposes **process 3.0** into the checks and writes behind joining an event. It retains the parent process's volunteer actor, enrollment result, and D1–D4 stores.

```mermaid
flowchart TB
    accTitle: Level 2 data-flow diagram - volunteer enrollment
    accDescr: Process 3.0 expands into five steps that validate the current session, read and lock event eligibility, check membership and capacity, insert a registration and record activity. All inputs, outputs and stores match the parent enrollment process.
    V["Volunteer"]
    D1[("D1 · Accounts and access")]
    D2[("D2 · Events and request keys")]
    D3[("D3 · Participants")]
    D4[("D4 · Activity and audit")]

    P31("3.1<br/>Validate volunteer<br/>session and account")
    P32("3.2<br/>Read and lock<br/>organizer and event")
    P33("3.3<br/>Validate eligibility,<br/>membership and capacity")
    P34("3.4<br/>Insert participant<br/>record")
    P35("3.5<br/>Record activity and<br/>commit transaction")

    V -->|"Event ID and session token"| P31
    D1 -->|"Current session and account"| P31
    P31 -->|"Authenticated volunteer request"| P32
    D1 -->|"Organizer approval and access"| P32
    D2 -->|"Event owner, date, status and capacity"| P32
    P32 -->|"Locked event and organizer data"| P33
    D3 -->|"Existing membership and current count"| P33
    P33 -->|"Eligible registration data"| P34
    P33 -->|"Unavailable, duplicate or full result"| V
    P34 -->|"New participant record"| D3
    P34 -->|"Participation action data"| P35
    P35 -->|"Personal notice and audit entry"| D4
    P35 -->|"Committed registration confirmation"| V

    classDef actor fill:#eff6ff,stroke:#2563eb,color:#172554
    classDef process fill:#ecfdf5,stroke:#059669,color:#064e3b
    classDef store fill:#fff7ed,stroke:#ea580c,color:#7c2d12
    class V actor
    class P31,P32,P33,P34,P35 process
    class D1,D2,D3,D4 store
```

**The enrollment guarantee:** an active, verified volunteer can join only an approved future event from an approved, active NGO, once, and while capacity remains. Organizer/event locks and one transaction protect the participant record, personal notice, and audit entry. Confirmation is returned only after commit; failures roll back the writes.

Other process families remain at Level 1. Withdrawal, attendance, roster reading, and moderation are documented separately in the [process map and rules](docs/SYSTEM-DESIGN.md).

## Use case diagrams

These UML-style views show **who can do what**, using GitHub-compatible Mermaid shapes: actor boxes outside a system boundary and oval use cases inside it.

**Legend:** solid lines = actor participation · **«include»** = required behavior · **«extend»** = behavior added under a stated condition. Authentication and ownership checks are preconditions for protected operations, rather than a repeated sign-in step.

### 1. Discovery and account access

Guests can explore before registering. Account holders manage their access and personal activity; self-service account deletion is available to NGOs and volunteers.

```mermaid
flowchart LR
    accTitle: Use cases - discovery and accounts
    accDescr: Signed-out visitors can discover events, register, verify email and request recovery. Account holders can sign in or out, maintain profiles and read activity. Only NGO and volunteer accounts have self-service deletion.
    Visitor["«actor»<br/>Guest / signed-out visitor"]
    Member["«actor»<br/>Account holder<br/>Volunteer · NGO · Admin"]
    Personal["«actor»<br/>NGO / Volunteer"]

    subgraph System["Community Help Platform · Discovery and accounts"]
        Browse(["Browse approved NGOs<br/>and upcoming events"])
        Register(["Register as NGO<br/>or volunteer"])
        Verify(["Verify email address"])
        Recover(["Request verification<br/>or password recovery"])
        SignIn(["Sign in / sign out"])
        Profile(["Update profile<br/>or change password"])
        Activity(["Read personal activity"])
        Delete(["Delete own account"])
    end

    Visitor --- Browse
    Visitor --- Register
    Visitor --- Verify
    Visitor --- Recover
    Member --- Browse
    Member --- SignIn
    Member --- Profile
    Member --- Activity
    Personal --- Delete

    classDef actor fill:#eff6ff,stroke:#2563eb,color:#172554
    classDef usecase fill:#ffffff,stroke:#7c3aed,color:#3b0764
    class Visitor,Member,Personal actor
    class Browse,Register,Verify,Recover,SignIn,Profile,Activity,Delete usecase
```

### 2. Volunteering and NGO event management

Volunteers manage their participation. NGOs manage owned events, participant rosters, and attendance. Joining includes the eligibility/capacity check; event creation and edits remain subject to review.

```mermaid
flowchart LR
    accTitle: Use cases - volunteering and NGO event management
    accDescr: Volunteers register, withdraw and view their events. NGOs submit and edit events, cancel or complete them, view their rosters and record attendance. Joining always includes eligibility and capacity checks.
    Volunteer["«actor»<br/>Volunteer"]
    NGO["«actor»<br/>NGO"]

    subgraph System["Community Help Platform · Events and participation"]
        Join(["Join an event"])
        Rules(["Check event eligibility<br/>and available capacity"])
        Withdraw(["Withdraw registration"])
        Mine(["View own registrations<br/>and current event status"])
        Submit(["Create or edit an event<br/>and submit for review"])
        Close(["Cancel or complete<br/>an owned event"])
        Roster(["View owned-event<br/>participant roster"])
        Attendance(["Record attendance<br/>for a completed event"])
    end

    Volunteer --- Join
    Volunteer --- Withdraw
    Volunteer --- Mine
    NGO --- Submit
    NGO --- Close
    NGO --- Roster
    NGO --- Attendance
    Join -.->|"«include»"| Rules

    classDef actor fill:#eff6ff,stroke:#2563eb,color:#172554
    classDef usecase fill:#ffffff,stroke:#7c3aed,color:#3b0764
    class Volunteer,NGO actor
    class Join,Rules,Withdraw,Mine,Submit,Close,Roster,Attendance usecase
```

### 3. Administration and review

Administrators review NGOs and events, manage volunteer access, and inspect recorded actions. Rejecting or revoking approval adds the required reason to the decision.

```mermaid
flowchart LR
    accTitle: Use cases - administration and review
    accDescr: Administrators review NGO registrations and events, manage volunteer access and inspect audit history. Rejection and approval revocation require feedback.
    Admin["«actor»<br/>Administrator"]

    subgraph System["Community Help Platform · Administration"]
        NGOs(["Review NGOs:<br/>approve, reject or restore"])
        Events(["Review events:<br/>approve, reject or revoke"])
        Access(["Disable or restore<br/>volunteer access"])
        Audit(["Inspect recorded<br/>action history"])
        Reason(["Provide rejection<br/>or revocation reason"])
    end

    Admin --- NGOs
    Admin --- Events
    Admin --- Access
    Admin --- Audit
    Reason -.->|"«extend»: rejection decision"| NGOs
    Reason -.->|"«extend»: rejection decision"| Events

    classDef actor fill:#eff6ff,stroke:#2563eb,color:#172554
    classDef usecase fill:#ffffff,stroke:#7c3aed,color:#3b0764
    class Admin actor
    class NGOs,Events,Access,Audit,Reason usecase
```

<details>
<summary><strong>Permission and lifecycle details</strong></summary>

- Volunteers must verify their email before signing in. NGOs must also be approved before creating or editing events.
- Rejected NGOs may sign in to correct and resubmit their profile.
- Public browsing exposes only approved, scheduled, future events from active approved NGOs.
- Volunteers may withdraw from unavailable or cancelled events; completed attendance records remain.
- An NGO can read only its own participant rosters. Recording attendance also requires an approved organizer and a completed event.
- Cancellation and completion are distinct actions with different eligibility rules.
- Administrator review uses the current record version/status to prevent stale decisions.

See [API permissions](docs/API.md) and [diagram scope](docs/SYSTEM-DESIGN.md) for the exact boundaries.

</details>

## Getting started

### Prerequisites

- **Node.js:** 22.13+, 24, or 26.
- **MySQL:** 8.0 or later with InnoDB.
- **Git** and a modern web browser.

### 1. Clone and install

```sh
git clone https://github.com/harsha160507/CommunityHelpPlatform.git
cd CommunityHelpPlatform
npm ci
```

### 2. Prepare MySQL

Create the application database from a MySQL administrator session:

```sql
CREATE DATABASE community_help
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Create a dedicated database user and grant it access to this database. The account used for migrations needs schema permissions. For production, use a separate runtime account with only the permissions described in the [deployment guide](docs/DEPLOYMENT.md).

### 3. Configure the environment

Copy `.env.example` to `.env`:

```sh
# macOS / Linux
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

Fill in your own database credentials and review these settings:

| Setting                  | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `DB_HOST`, `DB_PORT`     | Your MySQL server address and port.                                     |
| `DB_USER`, `DB_PASSWORD` | Your dedicated database account credentials.                            |
| `DB_NAME`                | The database you created, such as `community_help`.                     |
| `BASE_URL`               | The application origin; locally, `http://localhost:3000`.               |
| `EVENT_TIMEZONE`         | The IANA timezone used for events, such as `Asia/Kolkata`.              |
| `DEV_MAIL_PREVIEW`       | Set to `true` for local verification and password-reset email previews. |

**Keep real credentials in your local environment or hosting configuration. Never commit `.env`.**

### 4. Initialize the database and administrator

```sh
npm run migrate
```

Set `ADMIN_EMAIL` and a unique, strong `ADMIN_PASSWORD` in your local environment or `.env`, then run:

```sh
npm run admin:setup
```

There are **no default administrator credentials**. Remove the bootstrap variables afterward. Running this command for an existing administrator resets its password and revokes its sessions.

### 5. Start the application

```sh
npm start
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

For backend development with automatic restarts:

```sh
npm run dev
```

The server serves both the interface and `/api`. Open the application URL rather than the HTML file directly.

### Verify a local account

New accounts must verify their email before signing in. With development mail preview enabled, register an account and run:

```sh
npm run mail:preview
```

Open the verification link printed in your terminal. NGO accounts also need administrator approval before creating events.

Production uses SMTP instead of development previews. See the [deployment guide](docs/DEPLOYMENT.md) for delivery settings.

## Project structure

```text
CommunityHelpPlatform/
├── backend/
│   ├── src/
│   │   ├── routes/          # Account, admin, event and volunteer endpoints
│   │   ├── app.js           # Application assembly and security middleware
│   │   ├── server.js        # Startup, background mail and shutdown
│   │   ├── db.js            # MySQL access and transactions
│   │   └── validation.js    # Input and timezone rules
│   └── scripts/             # Migrations, admin setup and mail preview
├── database/
│   └── migrations/          # Versioned schema changes
├── frontend/                # HTML, CSS and browser JavaScript
├── tests/
│   ├── unit/                # Validation and configuration
│   ├── integration/         # Real-MySQL workflows and concurrency
│   └── e2e/                 # Browser and accessibility checks
├── docs/                    # API, deployment and maintenance guides
├── scripts/                 # Source and import checks
├── .github/                 # CI, dependency updates and issue templates
├── .env.example             # Configuration template
└── package.json             # Dependencies and project commands
```

## How events and accounts work

- **Approval comes first.** Public opportunities require an approved, active NGO and an approved scheduled event.
- **Registration closes at the start.** Events must begin in the future, with capacity between 1 and 10,000. Capacity is checked transactionally when volunteers join.
- **Times have a clear meaning.** Events use one configured timezone and same-day start/end times. Date-only values stay in `YYYY-MM-DD` format; ambiguous or nonexistent daylight-saving times are rejected.
- **Changes get reviewed.** NGO profile changes trigger NGO re-review; event edits trigger event re-review. Capacity cannot drop below existing registrations.
- **Participants can follow changes.** Cancellation and review status remain visible in registered events, with updates in personal activity. Volunteers can withdraw from unavailable events; completed attendance records are retained.
- **Account access is revocable.** Sessions expire after 12 hours and are revoked by logout, password changes/resets, or account disabling. Passwords require at least 12 characters and at most 72 UTF-8 bytes.
- **Participant contact details stay with the organizer.** Joining shares those details with the event's NGO.
- **Deletion removes identity fields.** Historical event/audit records remain, and scheduled NGO events are cancelled. Administrator deletion and email-address corrections are operator-managed.

## Quality checks

Run the standard checks:

```sh
npm run check
npm run lint
npm run format:check
npm test
npm audit --audit-level=high
```

For database and browser checks, create a **disposable database** whose name ends in `_test`, configure its `DB_*` settings, and set `ALLOW_TEST_DB_RESET=1`.

```sh
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

> [!WARNING]
> Integration tests erase all tables in the configured test database. Never use your development or production database. Run browser tests after integration tests; they reuse that schema and start a local server on port 33418.

CI covers Node.js **22, 24, and 26** with MySQL. Browser checks run on Node.js 24 and include automated desktop/mobile accessibility checks.

## Documentation

| Guide                                                  | What you will find                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| [System design & diagram guide](docs/SYSTEM-DESIGN.md) | Process-to-code mapping, store dictionary, and diagram notation and scope.                |
| [API reference](docs/API.md)                           | Endpoints, authentication, pagination, responses, and role permissions.                   |
| [Deployment & maintenance](docs/DEPLOYMENT.md)         | Production setup, SMTP, migrations, monitoring, backups, and recovery.                    |
| [Fix report](docs/FIX-REPORT.md)                       | The 36 audit findings, implemented improvements, validation, and remaining owner actions. |
| [Security response](docs/SECURITY-RESPONSE.md)         | Required steps for credentials exposed by earlier versions.                               |
| [Contributing](CONTRIBUTING.md)                        | Development expectations and the contribution workflow.                                   |
| [Security policy](SECURITY.md)                         | How to report security concerns responsibly.                                              |

<details>
<summary><strong>Upgrading an existing installation?</strong></summary>

Back up your database and read the [deployment guide](docs/DEPLOYMENT.md) before applying migrations.

- Existing accounts must verify their email.
- Legacy administrator accounts remain disabled until explicitly reset with `npm run admin:setup`.
- Previous JWT sessions are no longer accepted.
- Any credentials exposed in earlier commits must be rotated at the actual services. Removing a file does not remove historical copies or invalidate a password.
- Production requires HTTPS, configured SMTP, and a dedicated database account.

</details>

## Contributing

Have an improvement or a reproducible bug to share? Read [CONTRIBUTING.md](CONTRIBUTING.md), open an issue, or propose a focused pull request.

Please keep credentials and personal information out of public reports.

## License

This project currently reserves its rights under [LICENSE](LICENSE); it does not grant an open-source distribution license. Third-party dependencies retain their respective licenses.

---

<div align="center">
  <strong>A little time. A shared purpose. A stronger community.</strong>
</div>
