# Onboarding a new clinic (≈ 20–30 minutes)

Everything below is done in the owner dashboard. No code changes are needed, whether the vertical is dental,
dermatology, physio, salon, vet or legal.

1. **Create the tenant and the owner login (2 min).** For now this is one SQL insert or a copy of
   `src/clinic/seed.ts` with the new clinic's basics: slug, names, vertical, timezone, ref prefix. Then create an
   owner user with a hashed password (`hashPassword()` in `src/lib/crypto.ts`). A sign-up screen is listed in TODO.md.
2. **Settings → العيادة والسياسات (5 min).** Names AR/EN, phone, WhatsApp, email, brand colour (the whole site re-themes),
   deposit, free-cancellation window, minimum notice, slot step, pay-at-clinic / kiosk switches, reminder hour,
   Google rating and reviews link, custom domain.
3. **Settings → الفروع (3 min).** Address AR/EN, district (used in "<service> في <district>" pages), lat/lng.
4. **Settings → الخدمات (5 min).** Name, description, duration, buffer, price ("from"), optional per-service deposit.
5. **Settings → الأطباء (5 min).** Name, title, photo URL (upload to `/public/img` or a CDN), rating, then tick the services each doctor offers.
6. **الأطباء والجداول (5 min).** Add each doctor's shifts per branch and weekday, plus holidays and time off.
7. **Settings → التقييمات / معرض الصور / نصوص الصفحة (5 min).** Paste Google reviews verbatim, add gallery photos
   (tick consent for patient photos), and adjust the hero and SEO texts.
8. **Go live.**
   - DNS: point the clinic's domain (or `<slug>.<ROOT_DOMAIN>`) to the app and set the custom domain in settings.
   - Paymob: set `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_HMAC_SECRET` and integration ids; set the
     transaction-processed callback URL to `https://<domain>/api/payments/paymob/webhook`.
   - WhatsApp: approve the six templates (names in ARCHITECTURE.md), set `WHATSAPP_TOKEN`, the phone number id
     (per clinic in settings) and `WHATSAPP_APP_SECRET`; set the webhook URL to `https://<domain>/api/whatsapp/webhook`
     with `WHATSAPP_VERIFY_TOKEN`.
9. **Smoke test.** Book from a phone, pay with a Paymob test card, tap تأكيد on the reminder, and check the reception board.
