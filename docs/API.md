# API contract

The UI and API share one origin. All request/response bodies are JSON. Mutations with a browser Origin header must match BASE_URL. Authenticated requests supply `Authorization: Bearer <opaque-session-token>`; the former JWT API is intentionally replaced.

Errors: `{"message":"..." }`. Codes: 400 invalid input, 401 missing/expired/revoked session, 403 role/origin restriction, 404 missing record, 409 duplicate/stale decision/unavailable capacity, 429 throttled, 500 unexpected failure. Request IDs are returned as X-Request-Id. Database details and credentials are never returned.

Lists accept `page` (default 1) and `limit` (default 12, maximum 50) and return the named collection plus `pagination: {page,limit,total,pages}`. Date-only values use YYYY-MM-DD; event times are HH:MM:SS in the configured timezone. Timestamps represent UTC.

## Public

| Method | Path          | Result                                                              |
| ------ | ------------- | ------------------------------------------------------------------- |
| GET    | /api/config   | Event timezone, dashboard refresh interval, dev preview flag        |
| GET    | /api/stats    | Active verified volunteers, approved NGOs, eligible upcoming events |
| GET    | /api/ngos     | Approved active NGO directory                                       |
| GET    | /api/events   | Eligible upcoming events, organizer details, capacity/count         |
| GET    | /health/live  | Process liveness                                                    |
| GET    | /health/ready | Database/schema readiness; 503 when unavailable                     |

## Accounts

| Method | Path                           | Body / behavior                                                                                            |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| POST   | /api/auth/register             | name, email, password, role=ngo/volunteer; optional phone/location/interest; description required for NGOs |
| POST   | /api/auth/login                | email,password; returns a session token after email verification                                           |
| POST   | /api/auth/request-verification | email; generic response; eligible accounts receive 30-minute link                                          |
| POST   | /api/auth/forgot-password      | email; generic response; eligible accounts receive 30-minute link                                          |
| POST   | /api/auth/verify               | token; single-use verification                                                                             |
| POST   | /api/auth/reset                | token,password; revokes sessions and single-use account links                                              |
| GET    | /api/auth/me                   | Current account/profile/review/version; authenticated                                                      |
| POST   | /api/auth/logout               | Revokes current session; authenticated                                                                     |
| PUT    | /api/auth/profile              | name, phone, location, interest, description, version; authenticated; NGO changes require re-review        |
| POST   | /api/auth/change-password      | currentPassword,password; revokes all sessions                                                             |
| DELETE | /api/auth/account              | password; deletes identity fields and revokes access; NGO/volunteer only                                   |
| GET    | /api/activity                  | Current user's persistent in-app notifications; authenticated                                              |

Registration: 5/IP/hour. Login/password operations: 20/IP/15 minutes. Verification/reset requests and link redemption: 10/IP/hour. Limits are process-local; use a shared gateway/store before scaling horizontally. Recovery never reveals whether an email exists.

## NGO event ownership

| Method | Path                                      | Body / behavior                                                                                                                    |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/events/mine                          | Paginated owned events, all review/lifecycle states                                                                                |
| GET    | /api/events/:id/owner                     | Owner-only event detail                                                                                                            |
| POST   | /api/events                               | title,description,event_date,location,start_time,end_time,capacity; Idempotency-Key header (16–80 letters/digits/hyphens) required |
| PUT    | /api/events/:id                           | Full event fields plus current version; resubmits future scheduled event for review                                                |
| POST   | /api/events/:id/cancel                    | version; closes scheduled event and notifies participants                                                                          |
| POST   | /api/events/:id/complete                  | version; approved event must have ended; notifies participants                                                                     |
| GET    | /api/events/:id/participants              | Owner-only paginated roster including contact details and attendance                                                               |
| PATCH  | /api/events/:id/participants/:volunteerId | attended boolean; approved organizer, completed event                                                                              |

Creation/edit require organizer approval. Same-key creation retries return the original event ID (200 replay; 201 initial insert). Reusing a key for a different submission is not supported; use a new key for each intended event.

## Volunteers

| Method | Path                            | Behavior                                                                         |
| ------ | ------------------------------- | -------------------------------------------------------------------------------- |
| GET    | /api/volunteers/my-events       | Registered events including organizer/review/lifecycle/attendance state          |
| POST   | /api/volunteers/events/:id/join | Locks organizer/event, rechecks eligibility and capacity; duplicate/conflict=409 |
| DELETE | /api/volunteers/events/:id/join | Withdraws from an event; completed records cannot be withdrawn                   |

## Administrators

| Method | Path                      | Body / behavior                                                                       |
| ------ | ------------------------- | ------------------------------------------------------------------------------------- |
| GET    | /api/admin/ngos           | Full review data; optional status=pending/approved/rejected                           |
| GET    | /api/admin/volunteers     | Account status/details                                                                |
| GET    | /api/admin/events         | Full review data; optional status filter                                              |
| PATCH  | /api/admin/ngos/:id       | status,expectedStatus,version,reason (required on rejection)                          |
| PATCH  | /api/admin/events/:id     | Same decision fields; approval requires eligible organizer and future scheduled event |
| PATCH  | /api/admin/volunteers/:id | disabled boolean,version; disabling revokes sessions                                  |
| GET    | /api/admin/audit          | Paginated actor/action/entity/timestamp history                                       |

Refresh data after 409 and review it again. Do not automatically replay a stale administrator decision.
