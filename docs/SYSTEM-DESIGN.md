# System design and diagram guide

This guide explains the six diagrams embedded in the [project README](../README.md#data-flow-diagrams). The models describe the implemented Node.js/Express/MySQL application, rather than a proposed future design.

## Diagram index

| View                     | Purpose                                                                          | Editable source                                                       |
| ------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Level 0 DFD              | Application boundary and external data exchanges.                                | [dfd-level-0.mmd](diagrams/dfd-level-0.mmd)                           |
| Level 1 DFD              | Five logical processes and their shared stores.                                  | [dfd-level-1.mmd](diagrams/dfd-level-1.mmd)                           |
| Level 2 DFD              | Decomposition of process 3.0: volunteer enrollment.                              | [dfd-level-2.mmd](diagrams/dfd-level-2.mmd)                           |
| Accounts use cases       | Discovery, registration, verification, access, recovery, profiles, and deletion. | [use-cases-accounts.mmd](diagrams/use-cases-accounts.mmd)             |
| Participation use cases  | Volunteer participation and NGO event operations.                                | [use-cases-participation.mmd](diagrams/use-cases-participation.mmd)   |
| Administration use cases | Reviews, access changes, and audit history.                                      | [use-cases-administration.mmd](diagrams/use-cases-administration.mmd) |

## Reading the notation

- DFD external actors are rectangles, processes are green rounded/circular nodes, and logical stores are orange cylinders.
- Arrows name data payloads, queries, or results. Two-headed arrows compact a paired request/response or read/write exchange; they do not imply unrestricted access.
- Level 1 uses repeated actor/store references to keep individual process panels readable. Every D1 reference denotes the same logical records, and likewise for D2–D5.
- The Level 1 panel order is a layout choice, not an execution sequence. Processes share data through the named stores.
- In use-case diagrams, actors sit outside the system boundary and oval nodes represent goals. A solid line is an association. An «include» arrow points from a use case to required included behavior. An «extend» arrow points from the conditional addition to its base use case.
- Use-case shapes are expressed in compatible Mermaid flowcharts so the README can render them alongside its DFDs without an external image service.

## Logical data stores

All five logical stores live in the configured **single MySQL application database**.

| ID  | Backing tables                                    | Important contents                                                                                                                |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `chp_users`, `chp_sessions`, `chp_account_tokens` | Profile, role, review/verification/disabled state; hashed session tokens; hashed expiring verify/reset tokens.                    |
| D2  | `chp_events`, `chp_event_requests`                | Organizer, dates/times, capacity, approval, lifecycle, version, review feedback; per-NGO event-submission idempotency keys.       |
| D3  | `chp_event_participants`                          | Event/volunteer membership, unique registration constraint, attendance flag.                                                      |
| D4  | `chp_notifications`, `chp_audit_log`              | User-specific activity messages and recorded actor/action/entity/timestamp entries.                                               |
| D5  | `chp_mail_outbox`                                 | Recipient, subject, account-email payload, send attempts and accepted-send timestamp. Bodies are cleared after a successful send. |

A store label names a group of tables. A process connected to that group uses only the records/fields needed for its operation; it does not necessarily read every table in the group.

## Process-to-code map

| Process                                  | Behavior                                                                                                                             | Current implementation                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.0 — Accounts and sessions**          | Registration, verification/reset links, login/logout, profile changes, password changes and account deletion.                        | [auth.js](../backend/src/routes/auth.js), [middleware.js](../backend/src/middleware.js), [services.js](../backend/src/services.js).                                                       |
| **2.0 — Moderation and event lifecycle** | NGO/event review, volunteer disabling/restoration, event submission/edit/cancellation/completion, withdrawal and attendance changes. | [admin.js](../backend/src/routes/admin.js), [events.js](../backend/src/routes/events.js), withdrawal in [volunteers.js](../backend/src/routes/volunteers.js).                             |
| **3.0 — Enrollment**                     | Join an approved eligible event without duplicate registration or capacity overbooking.                                              | Join handler in [volunteers.js](../backend/src/routes/volunteers.js), `lockEvent` in [events.js](../backend/src/routes/events.js), transaction boundary in [db.js](../backend/src/db.js). |
| **4.0 — Discovery and permitted views**  | Public directory/events/counts, own registrations/events, owner rosters, personal activity, admin review data and audit queries.     | Read handlers in [app.js](../backend/src/app.js) and the role-specific routes, using [pagination.js](../backend/src/pagination.js).                                                       |
| **5.0 — Account email delivery**         | Read queued verification/recovery messages, send through SMTP, record acceptance/failure and retry state.                            | [mail.js](../backend/src/mail.js), scheduled by [server.js](../backend/src/server.js).                                                                                                    |

These are logical responsibilities, not a claim that each numbered process is a separate service or maps one-to-one to one route file.

Cross-cutting authentication, role checks, input validation, transactions and safe error handling are applied inside the protected processes. Profile/account deletion also has cascading effects, such as cancelling owned scheduled events; those secondary writes are described in [the API](API.md) and [account rules](../README.md#how-events-and-accounts-work), rather than adding every cascade to the overview.

## Level balancing

- **Level 0 → Level 1:** the same guest, volunteer, NGO, administrator and SMTP boundary is retained. User requests/results are separated by responsibility; SMTP exchanges belong to process 5.0.
- **Level 1 → Level 2:** only process **3.0** is expanded. Its input is a volunteer enrollment request, its output is an enrollment result, it reads D1/D2/D3, and it writes D3/D4.
- **No other process is expanded at Level 2.** Withdrawal/attendance updates stay in process 2.0 and read-only rosters/registrations in process 4.0.
- Standard authentication, validation, database and authorization errors return to the requesting actor. The diagrams show the main business results and enrollment conflicts without drawing every HTTP error branch.

## Enrollment detail

| Step    | Data responsibility                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **3.1** | Resolve the hashed session to a currently active, email-verified volunteer.                                                     |
| **3.2** | Read the organizer reference, lock the organizer account and event row, and load current approval/lifecycle/time/capacity data. |
| **3.3** | Reject unavailable/started events, rejected or disabled organizers, existing membership, and full capacity.                     |
| **3.4** | Insert the volunteer/event relationship into D3. The database also enforces uniqueness.                                         |
| **3.5** | Write the personal participation notice and audit entry to D4, then commit before returning success.                            |

Steps 3.2–3.5 run inside the same transaction. The transaction uses READ COMMITTED and consistent organizer/event locks. A failure rolls back registration and activity writes together; the diagram's arrows convey data dependencies, not separate network requests.

## Use-case conditions

| Action                    | Conditions and effects                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Join                      | Verified active volunteer, approved future scheduled event, approved active NGO, no duplicate membership, available capacity.                               |
| Withdraw                  | Current volunteer's own registration; completed records cannot be withdrawn. Cancellation or loss of approval does not prevent withdrawal.                  |
| Submit or edit an event   | Approved NGO; future event times and valid capacity. Edits resubmit the event for review.                                                                   |
| Correct NGO profile       | Authenticated NGO; saving resubmits the profile for review and temporarily hides its public events. Rejected NGOs can sign in for this purpose.             |
| Cancel                    | Owner of a scheduled event; affects current participants through in-app notices.                                                                            |
| Complete                  | Approved organizer, approved scheduled event, and the event's end time has passed.                                                                          |
| Read roster               | Authenticated owner NGO; participant contact data is not public.                                                                                            |
| Record attendance         | Approved owner NGO, completed event, existing participant record. Attendance changes are audited.                                                           |
| Review or revoke approval | Administrator, current version/expected status; rejection requires a reason. Event approval also requires a future scheduled event and approved active NGO. |
| Delete own account        | NGO/volunteer with password confirmation. Identity fields are removed; historical records remain. Administrator deletion is operator-managed.               |

## Email and activity boundaries

Account email and personal activity are separate:

- Verification/password-recovery payloads are queued in D5 and sent by process 5.0 using configured SMTP.
- An accepted SMTP send does not prove that a recipient opened or received a message in their inbox.
- Review decisions, event changes and participation actions create **in-app** notices in D4; they are not bulk participant emails.
- The overview refreshes activity every 30 seconds while visible. There is no WebSocket or push-notification service in these diagrams.
- In development preview mode, email sending is replaced by the local `npm run mail:preview` workflow.

## Scope

The business diagrams omit static asset delivery, health checks, migration administration, explicit administrator bootstrap, log transport, backup storage and expiry/retention cleanup. These operational concerns are covered in [DEPLOYMENT.md](DEPLOYMENT.md). No donation, payment, messaging/chat, geographic matching or external NGO-verification service is implied.

When changing behavior, update the relevant `.mmd` source and its matching Mermaid block in the README together. Keep process/store IDs stable when moving between levels.
