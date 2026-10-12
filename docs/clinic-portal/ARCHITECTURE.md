# Clinic portal: architecture

> The prompt asked to build on the existing "Manhal" codebase. That codebase is **not on this machine**, so this
> is a standalone app that follows the prompt's architecture. When it is merged into Manhal, swap the
> infrastructure pieces listed under *Replace when merging* for Manhal's equivalents. The booking engine, the
> clinic domain and the UI do not need to change.

## Stack

| Concern | Choice here | Notes |
|---|---|---|
| Framework | Next.js 16.4 (App Router, React 19, Turbopack) | `proxy.ts` replaces middleware in v16; route `params` are Promises |
| Language | TypeScript 7 `strict` | `npm run lint` = `tsc --noEmit` |
| Database | SQLite through Node 24's built-in `node:sqlite` | WAL mode; migrations in `src/lib/schema.ts`; no native modules |
| ORM | none: small typed SQL helpers (`src/lib/db.ts`) | every tenant query goes through `scoped(db, tenantId)` |
| Auth | signed HttpOnly session cookie (HMAC-SHA256) + scrypt passwords | roles: owner, receptionist, doctor |
| i18n | `src/i18n/dict.ts` + `format.ts` (Arabic-Indic digits, Cairo time) | Arabic default, English under `/en`, `hreflang` on every page |
| Payments | Paymob Intention API + Unified Checkout; HMAC-SHA512 transaction callback | local sandbox checkout when no keys are set |
| Messaging | WhatsApp Business Platform (Cloud API) templates + email fallback | messages simulated and logged when no token is set |
| Background jobs | in-process scheduler started from `instrumentation.ts` (every 60 s) | hold expiry, reminders, offer expiry |
| Tests | Vitest (`npm test`), worker threads for the concurrency test | 46 tests |

## Module layout

```
proxy.ts                      tenant URL rewriting: custom domain / subdomain / /c/:slug + /en
instrumentation.ts            starts the job scheduler
src/booking-engine/           GENERIC: no clinic imports (reused by the rentals project)
  time.ts                     Intl-based timezone maths (Cairo DST included)
  availability.ts             working windows − blocked intervals, sliced by duration+buffer
  engine.ts                   BookingStore port + createBookingEngine(availability, placeHold, expireHolds)
src/payments/paymob.ts        GENERIC Paymob adapter (HMAC, intention, refund, sandbox txn)
src/messaging/index.ts        GENERIC WhatsApp/email sender + MessageLog + webhook parsing/signature
src/clinic/                   the clinic vertical
  store.ts                    SQLite implementation of BookingStore (atomic holds)
  booking.ts                  holds → details → deposit/confirm, cancellation policy
  payment-webhook.ts          verified, idempotent Paymob callback (the ONLY path that confirms a paid deposit)
  whatsapp-inbound.ts         تأكيد / إلغاء / احجزه buttons, STOP opt-out
  waitlist.ts                 offer a freed slot to matching patients in order; first acceptance wins
  jobs.ts                     runDueJobs(now): hold expiry, day-before and 2-hour reminders, offer expiry
  reception.ts reports.ts admin.ts audit.ts seo.tsx site.ts seed.ts notifications.ts patients.ts repo.ts
src/server/                   Next-specific glue: db boot + demo seed, sessions, tenant resolution, API helpers
app/t/[lang]/                 public site (SSR): landing, /book, /book/done, /services/[service]/[branch], /privacy
app/(app)/                    staff app: /login, /dashboard/*, /pay/sandbox
app/api/                      public booking API, Paymob webhook, WhatsApp webhook, CSV export
```

## Data model

`tenants`, `branches` (+`branch_hours`), `providers`, `provider_branches`, `services`, `provider_services`,
`working_hours`, `time_off`, `patients` (contact only, phone AES-256-GCM encrypted with a blind index for
uniqueness), `appointments` (holds are appointments with `status='held'`), `payments`, `webhook_events`
(idempotency), `waitlist_entries`, `slot_offers` + `slot_offer_recipients`, `walk_ins`, `message_log`,
`gallery_cases`, `reviews`, `content_blocks`, `users`, `audit_log`. Times are stored in UTC ISO-8601 and shown in the
tenant timezone (`Africa/Cairo`).

## No double booking

1. **Database guarantee.** `BEFORE INSERT` and `BEFORE UPDATE` triggers on `appointments` abort with `SLOT_TAKEN`
   when an active row (held / pending_payment / confirmed / checked_in / completed) for the same provider overlaps
   `[start_utc, block_end_utc)`. `block_end_utc` includes the service buffer. The triggers ignore the wall clock:
   expired holds keep blocking until they are swept to `cancelled`.
2. **Sweep in the same transaction.** `insertHold` runs `BEGIN IMMEDIATE`, sweeps that doctor's lapsed holds,
   then inserts. SQLite serialises writers, so 20 concurrent requests produce exactly one winner
   (`tests/booking.test.ts`, which uses 20 worker threads with their own connections).
3. The engine also re-validates the requested start against live availability, so arbitrary times are rejected.

On Postgres, use an exclusion constraint instead:
`EXCLUDE USING gist (provider_id WITH =, tstzrange(start_utc, block_end_utc) WITH &&) WHERE (status IN (...))`.

## Payments (Paymob)

- API: Intention API `POST https://accept.paymob.com/v1/intention/` (Token secret key) → Unified Checkout URL.
  Callback: "transaction processed" POST with `?hmac=` = HMAC-SHA512 over the 20 documented fields
  (`PAYMOB_HMAC_FIELDS`). **I could not check Paymob's current docs from here; confirm the field list and
  endpoint versions before going live** (see TODO).
- Card / wallet: hold extended to 15 min while paying. Kiosk reference ("فوري" in the design; Paymob's kiosk
  integration is Aman/Masary): hold extended to min(24 h, 3 h before the appointment).
- Webhook order: verify HMAC (401 on forgery) → idempotency key in `webhook_events` (replay = no-op) → amount check
  → state change in one transaction. A late payment for a slot that was re-booked is marked `needs_refund`
  and never double-books.
- Refunds follow the clinic's cancellation window: refund when cancelled ≥ window hours before; forfeit after that
  or on a no-show; always refund when the clinic cancels.

## WhatsApp

Templates (Arabic and English, same variables): `booking_confirmation`, `reminder_day_before` (quick replies
`تأكيد`/`إلغاء`), `reminder_2h`, `cancellation_confirmation`, `slot_opened_offer` (quick reply `احجزه`),
`offer_too_late`. Button payloads carry unguessable tokens (`appt:<token>:confirm`). The webhook verifies
`X-Hub-Signature-256` and dedupes on the message id. Opt-out keywords: STOP / إيقاف. Graph API version used:
v21.0 (configurable in code). Check Meta's current template category and pricing rules before going live.

## Replace when merging into Manhal

`src/lib/db.ts` → Manhal ORM/DB; `src/server/session.ts` → Manhal auth; `src/messaging` → Manhal messaging layer;
`src/server/scheduler.ts` → Manhal job queue; `src/payments/paymob.ts` → Manhal's Paymob integration.
