# Changelog

## 0.1.0 (2026-10-09)

### Phase 1: tenancy, content and the landing page
- Multi-tenant resolution (custom domain → subdomain → `/c/:slug`, default tenant on localhost).
- Server-rendered Arabic (RTL) and English landing page built from tenant data and content blocks, matching `Main.dc.html`.
- Local SEO: per-page title/description in both languages, canonical + `hreflang`, `sitemap.xml`, `robots.txt`,
  JSON-LD (`Dentist`/`MedicalClinic` per branch with `openingHoursSpecification`, `geo`, rating, reviews),
  service pages `/services/<service>/<branch>` ("تقويم الأسنان في مدينة نصر").
- Owner settings: clinic and policies, services, doctors (+ services they offer), branches, reviews, gallery, landing copy, brand colour.

### Phase 2: booking engine
- Generic `src/booking-engine` (no clinic imports) with timezone-correct availability, buffers, breaks, branches.
- Holds (10 min) with a database-level no-overlap trigger; 20-way concurrency test.
- 4-step mobile booking UI (`Booking.dc.html`), Egyptian mobile validation → E.164.

### Phase 3: deposits with Paymob
- Card, wallet, kiosk reference, pay at clinic (if enabled). Verified, idempotent webhook; sandbox checkout.
- Refund / forfeit by cancellation window; declined payments free the slot immediately.

### Phase 4: WhatsApp and email
- Confirmation, day-before reminder (clinic hour) with تأكيد / إلغاء, optional 2-hour reminder, cancellation,
  waiting-list offers; inbound button handling, STOP opt-out, MessageLog, email fallback hook.

### Phase 5: reception dashboard
- Today board per branch (column per doctor, colour + text status), KPIs, waiting list, walk-ins, new booking,
  check-in / no-show / complete / reschedule / cancel, "offer to waiting list" + first-wins acceptance.
- Roles owner / receptionist / doctor (read-only own schedule), audit log, 20-second live refresh.

### Phase 6: reports
- Monthly report (bookings, online share, no-show rate, refills from the waiting list, deposits), no-show rate
  before vs. after deposits, CSV export.

### Fixes during the build
- The overlap trigger first treated holds as expired by the wall clock; changed it so expired holds are swept
  in the same write transaction (deterministic guarantee, found by the tests).
