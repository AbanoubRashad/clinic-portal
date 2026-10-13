# Deferred work

| Item | Why it is deferred |
|---|---|
| Merge into the Manhal codebase | Manhal isn't on this machine; see "Replace when merging" in ARCHITECTURE.md. |
| Verify Paymob API details (intention endpoint, HMAC field order, refund endpoint, kiosk flow) against current docs | Couldn't check Paymob's docs or a sandbox account from here. The code isolates this in `src/payments/paymob.ts`. |
| "Fawry" label vs. Paymob kiosk (Aman/Masary) | The design says Fawry; Paymob's kiosk integration is Aman/Masary. Confirm with the client or add a separate Fawry integration. |
| Real WhatsApp sending and template approval | Needs a Meta Business account. Without `WHATSAPP_TOKEN` messages are simulated and shown in "رسائل واتساب". |
| Email fallback transport (SMTP / SES) | No provider configured; email attempts are logged in `message_log`. |
| OTP verification of the patient's phone | The prompt mentions rate-limiting OTP endpoints but no OTP step; booking is rate-limited per IP instead. |
| Self-service tenant sign-up screen | Tenants are created by seed or SQL (ONBOARDING.md step 1). |
| Photo upload in admin | Admin takes image URLs. Add uploads once a storage bucket is chosen. |
| Drag-and-drop reschedule | The picker (select of free slots) is implemented; drag is a UI enhancement. |
| English dashboard | The staff dashboard is Arabic-only (matching the design). The public site is fully bilingual. |
| Multi-instance scheduler / rate limiter | Both are in-process (fine for one server). Use a queue/cron and Redis when scaling out. |
| Structured-data validation | JSON-LD was produced and checked locally; run it through Google's Rich Results Test once the site is on a public URL. |
| Photos | The sample photos are AI-generated previews; replace them with real photos before launch. |
