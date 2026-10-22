# Remindora architecture

## System overview

```mermaid
flowchart LR
  subgraph Clients
    WEB["Web<br/>Next.js 15 · TanStack Query · Zustand<br/>IndexedDB cache + offline outbox"]
    DESK["Desktop<br/>Tauri v2 shell + same Next.js UI (static export)<br/>OS keychain · tray · global shortcut · updater"]
    DROID["Android<br/>Expo SDK 58 / React Native 0.88<br/>SecureStore · biometrics · widget · FCM"]
  end

  subgraph Edge["API tier (stateless, horizontally scalable)"]
    API["NestJS REST API<br/>/docs (OpenAPI)<br/>Auth · RBAC guard · rate limits · audit"]
    RT["Socket.IO gateway<br/>/realtime (Redis adapter)"]
  end

  subgraph Workers["Background workers (BullMQ)"]
    REM["reminders<br/>fire + 60 s DB sweeper"]
    PUSHW["push<br/>notify · cross-device dismiss"]
    MAIL["email"]
    HOOK["webhooks · Slack · Notion"]
    MAINT["maintenance<br/>digests · habit reminders<br/>calendar import · housekeeping"]
  end

  PG[("PostgreSQL 17<br/>Prisma schema<br/>syncSeq trigger · pg_trgm")]
  REDIS[("Redis<br/>BullMQ queues · rate limits<br/>Socket.IO pub/sub · OAuth state")]
  S3[("S3-compatible storage<br/>attachments (presigned URLs)")]

  subgraph Providers["Delivery & integration providers"]
    FCM["Firebase Cloud Messaging<br/>(or Expo push service)"]
    WPUSH["Web Push (VAPID)"]
    SMTP["Email<br/>SMTP / Resend"]
    BILL["Billing<br/>Stripe (pluggable)"]
    EXT["Google / Outlook calendar<br/>Notion · Slack · Zapier · ICS feeds"]
    AI["AI provider<br/>Claude (pluggable) / heuristic"]
  end

  WEB & DESK & DROID -- "HTTPS JSON" --> API
  WEB & DESK & DROID <-- "WebSocket events" --> RT
  API --> PG
  API --> REDIS
  API --> S3
  RT <--> REDIS
  API -- "enqueue jobs" --> REDIS
  REDIS -- "jobs" --> Workers
  Workers --> PG
  Workers -- "emit via redis-emitter" --> REDIS
  PUSHW & REM --> FCM & WPUSH
  MAIL & REM --> SMTP
  HOOK --> EXT
  MAINT --> EXT
  API --> BILL
  BILL -- "signed webhooks" --> API
  API --> AI
  FCM --> DROID
  WPUSH --> WEB
```

**Source of truth.** PostgreSQL holds every durable fact, including the next fire time of each reminder (`Reminder.nextFireAt`). Redis holds delayed jobs, rate-limit counters, Socket.IO pub/sub and short-lived OAuth/biometric state. If Redis is wiped, the worker's 60-second sweeper re-queues every due reminder from Postgres.

## Packages

| Package | Responsibility |
|---|---|
| `@remindora/types` | Domain enums, zod input schemas (shared server validation + OpenAPI), DTOs, realtime event contract |
| `@remindora/core` | Quick-Add NLP parser, timezone helpers, DST-safe recurrence (rrule), ICS parser, habit streaks, field-level merge + outbox coalescing |
| `@remindora/auth` | AES-256-GCM secret envelopes, HS256 access tokens, OTP codes, QR pairing tokens, session validity rules, RBAC matrix |
| `@remindora/notifications` | Priority policy engine, Android channel mapping, queue contract, email sender + templates, SSRF-safe fetch |
| `@remindora/entitlements` | Plan catalog (seed defaults), DB/flag-driven resolution, limit checks |
| `@remindora/database` | Prisma schema, migrations, seed, ICS subscription sync |
| `@remindora/ui` | Design tokens and React design system (Tailwind v4 + Radix) |
| `@remindora/config` | Validated server environment, shared ESLint base |

## Request lifecycle

1. **Authentication**: `AuthGuard` verifies the bearer HS256 token, then loads the session and device and rejects revoked, expired or idle ones. Revocation therefore takes effect on the next request, not at token expiry.
2. **Rate limiting**: `RateLimitGuard` keeps fixed-window counters in Redis, shared across instances, and applies stricter per-route rules to auth and pairing.
3. **Validation**: every body and query goes through a zod schema (`ZodPipe`). The same schema generates the OpenAPI request body.
4. **Authorization**: services call `AccessService.workspace/project/task(user, id, permission)`. A user who isn't a member gets 404, a member lacking the permission gets 403, and every denial is written to the audit log.
5. **Entitlements**: `EntitlementsService` resolves code defaults, then plan rows, then per-user rows, then feature-flag gates. Values are cached for 30 s, and limits are enforced server-side (402 `plan_limit` / `plan_feature`).
6. **Side effects**: the activity log (user-visible history), the audit log (security trail), realtime fan-out to workspace/user/session rooms, BullMQ jobs, and webhooks.

## Priority notification engine

```mermaid
sequenceDiagram
  autonumber
  participant API
  participant DB as Postgres
  participant Q as Redis/BullMQ
  participant W as Worker
  participant P as FCM / Web Push / Email
  participant A as Device A
  participant B as Device B

  API->>DB: create/update task → Reminder.nextFireAt = initialFireAt(prefs, quiet hours, weekends, tz)
  API->>Q: delayed job (jobId = reminder:occurrence:attempt)
  Note over W: every 60 s the sweeper re-queues due reminders from DB
  Q->>W: fire job
  W->>DB: claim row (lockedUntil) · re-check task open · re-apply delivery window
  W->>DB: Notification (dedupeKey unique) + deliveries + events
  W-->>A: realtime notification.created {alert}
  W-->>B: realtime notification.created {alert}
  W->>P: push / web push / email per priority + channel prefs
  W->>DB: attempt+1, nextFireAt = nextRealertAt(priority, interval, maxRealerts)
  W->>Q: next re-alert job
  A->>API: POST /notifications/:id/action {complete|snooze|stop|acknowledge}
  API->>DB: reminder state, events
  API-->>B: realtime notification.resolved (dismiss in UI)
  API->>Q: push dismiss job → data-only push clears B's tray
  Q->>W: (later) stale re-alert job → skipped: state no longer ACTIVE
```

| Priority | Channels | Repeats |
|---|---|---|
| Critical | in-app + push + desktop + web push (+ email if opted in and entitled) | every `criticalRepeatMinutes` (default 30) until complete/snooze/acknowledge, max `maxRealerts` |
| High | in-app + push + desktop + web push | every `highRepeatMinutes` (default 120) until acknowledged |
| Medium | in-app + push + desktop + web push | once, plus optional single follow-up |
| Low / None | silent notification-center item, or morning digest only | never |

Safeguards:

- **Quiet hours.** Alerts that land inside quiet hours move to the end of the window. Critical alerts break through only if the user opts in.
- **Weekends.** If weekend alerts are off, they move to Monday morning.
- **Per-project overrides.** A project can be muted, or given its own channels and intervals.
- **Constant reminders** (a Premium feature) make a low-priority task repeat like a high-priority one.
- **Exactly-once delivery** for each occurrence and attempt comes from three mechanisms: the BullMQ `jobId`, a row-level claim, and a unique `Notification.dedupeKey`.
- **Lifecycle log.** Every `SCHEDULED`, `DELIVERED`, `OPENED`, `SNOOZED`, `FAILED`, `ACKNOWLEDGED`, `COMPLETED`, `STOPPED` and `SUPPRESSED` event is written to `NotificationEvent`. `/metrics` exposes the last 24 hours to Prometheus.

## Device linking

```mermaid
sequenceDiagram
  autonumber
  participant D as Desktop/Web (signed in)
  participant API
  participant P as Phone (signed out)

  D->>API: POST /pairing (requires re-auth ≤ 5 min)
  API-->>D: qrToken = rmd1.AES-GCM({pid, secret, exp=60 s}) · stores sha256(secret) only
  D->>D: render QR remindora://link?t=…
  P->>P: scan · biometric confirmation
  P->>API: POST /pairing/claim {token, device}
  API->>API: decrypt+verify · expiry · atomic PENDING→CLAIMED (single use)
  API-->>P: claimSecret + 4-digit code
  API-->>D: realtime pairing.claimed {device name, same code}
  D->>API: POST /pairing/:id/decision {approve:true}
  P->>API: poll status → APPROVED
  P->>API: POST /pairing/claim/:id/complete {claimSecret}
  API->>API: atomic APPROVED→CONSUMED · new Device + Session
  API-->>P: tokens (refresh → Android Keystore SecureStore)
  API-->>D: realtime pairing.completed
```

Email linking uses a 6-digit code plus a magic link. Both are single-use, expire after 10 minutes, are limited to 5 attempts, and are rate-limited per email and per IP. The device that asked for the code holds a `pollSecret`, so a magic link opened on another device can verify the request but only the asking device receives the session.

When the user's setting is on and another device was active in the last 14 days, a new sign-in waits for approval from a signed-in device (`device.approval_requested` plus a push). Refresh tokens rotate, and reuse of a rotated token revokes the session. Native devices can enrol a biometric-gated secret: `HMAC(secret, nonce)` proves biometric unlock for re-authentication.

## Offline-first sync

- **Cache.** Clients persist their query cache (IndexedDB on web/desktop, AsyncStorage on Android), so the app opens instantly even without a network.
- **Outbox.** Mutations made offline are queued with a `clientId` (idempotent creates) or a `baseVersion` (edits). Consecutive edits to the same entity are coalesced, and the queue replays when the connection returns.
- **Field-level merge.** Each task carries `version` and `fieldVersions`. An edit made against `baseVersion` conflicts only on fields that someone else changed after that version; other fields merge. A conflict returns `409 edit_conflict` along with the server copy. The web UI offers *keep mine* or *keep theirs*; on Android the server copy wins.
- **Catch-up feed.** A Postgres trigger stamps every task and project write with a global `syncSeq`. `GET /sync/changes?cursor=` returns everything after the cursor, including soft-deleted tombstones.
- **Realtime.** `task.upserted` and `task.deleted` events go to workspace rooms with `originSessionId`, so the device that made a change ignores its own echo.

## Data model

All timestamps are `timestamptz` (UTC); the UI renders them in the user's IANA timezone. User content is soft-deleted, and items in Trash are purged after 30 days. The models are:

`User`, `Account`, `Session`, `Device`, `EmailChallenge`, `DevicePairingToken`, `Workspace`, `Membership`, `Invite`, `Folder`, `Project`, `Section`, `Task`, `Subtask`, `Tag`, `TaskTag`, `TaskDependency`, `Favorite`, `RecurrenceRule`, `Reminder`, `Attachment`, `Comment`, `ActivityEvent`, `AuditLog`, `Habit`, `HabitCheckIn`, `FocusSession`, `Countdown`, `SavedFilter`, `Template`, `Notification`, `NotificationDelivery`, `NotificationEvent`, `NotificationPreference`, `ProjectNotificationOverride`, `Subscription`, `Entitlement`, `FeatureFlag`, `BillingEvent`, `Integration`, `CalendarSubscription`, `ExternalEvent`.

See `packages/database/prisma/schema.prisma`.
