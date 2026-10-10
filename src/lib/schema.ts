// Ordered, append-only migrations. Never edit a released migration; add a new one.

const ACTIVE = "'held','pending_payment','confirmed','checked_in','completed'";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

// An appointment row blocks its provider's time while its status is active. Expired holds keep
// blocking until they are swept to 'cancelled' (the app sweeps inside the same write transaction
// before inserting), so the guarantee never depends on the wall clock.
const BLOCKING = (a: string) => `${a}.status IN (${ACTIVE})`;

export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE tenants (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  custom_domain TEXT UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  short_name_ar TEXT NOT NULL,
  short_name_en TEXT NOT NULL,
  tagline_ar TEXT NOT NULL DEFAULT '',
  tagline_en TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#1458C2',
  ref_prefix TEXT NOT NULL DEFAULT 'BK',
  vertical TEXT NOT NULL CHECK (vertical IN ('dental','derma','physio','salon','vet','legal')),
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  google_rating REAL,
  google_reviews_count INTEGER,
  google_reviews_url TEXT,
  years_experience INTEGER,
  deposit_amount INTEGER NOT NULL DEFAULT 0,
  deposits_enabled_at TEXT,
  allow_pay_at_clinic INTEGER NOT NULL DEFAULT 1,
  allow_kiosk INTEGER NOT NULL DEFAULT 1,
  cancellation_window_hours INTEGER NOT NULL DEFAULT 24,
  min_notice_minutes INTEGER NOT NULL DEFAULT 60,
  slot_step_minutes INTEGER NOT NULL DEFAULT 30,
  booking_horizon_days INTEGER NOT NULL DEFAULT 21,
  hold_minutes INTEGER NOT NULL DEFAULT 10,
  reminder_hour INTEGER NOT NULL DEFAULT 18,
  reminder_2h_enabled INTEGER NOT NULL DEFAULT 0,
  whatsapp_phone_number_id TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE branches (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  district_ar TEXT NOT NULL,
  district_en TEXT NOT NULL,
  address_ar TEXT NOT NULL,
  address_en TEXT NOT NULL,
  lat REAL,
  lng REAL,
  google_place_id TEXT,
  phone TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, slug)
);

-- weekday: 0 = Sunday ... 6 = Saturday; minutes from local midnight
CREATE TABLE branch_hours (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  open_min INTEGER NOT NULL,
  close_min INTEGER NOT NULL CHECK (close_min > open_min)
);

CREATE TABLE providers (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  short_ar TEXT NOT NULL,
  short_en TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  specialty_ar TEXT NOT NULL DEFAULT '',
  specialty_en TEXT NOT NULL DEFAULT '',
  bio_ar TEXT NOT NULL DEFAULT '',
  bio_en TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT 'm' CHECK (gender IN ('m','f')),
  photo_url TEXT,
  rating REAL,
  years_experience INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, slug)
);

CREATE TABLE provider_branches (
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, branch_id)
);

CREATE TABLE services (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  desc_ar TEXT NOT NULL DEFAULT '',
  desc_en TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  buffer_min INTEGER NOT NULL DEFAULT 0,
  price_egp INTEGER NOT NULL,
  price_is_from INTEGER NOT NULL DEFAULT 0,
  deposit_egp INTEGER,            -- NULL = clinic default, 0 = no deposit for this service
  active INTEGER NOT NULL DEFAULT 1,
  show_on_landing INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, slug)
);

CREATE TABLE provider_services (
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, service_id)
);

CREATE TABLE working_hours (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL CHECK (end_min > start_min)
);

-- provider_id NULL = whole clinic (holiday); branch_id NULL = every branch
CREATE TABLE time_off (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT
);

-- Contact details only. No medical history fields, by design.
CREATE TABLE patients (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone_enc TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  phone_last4 TEXT NOT NULL,
  email TEXT,
  lang TEXT NOT NULL DEFAULT 'ar' CHECK (lang IN ('ar','en')),
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  whatsapp_opt_out INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  UNIQUE (tenant_id, phone_hash)
);

CREATE TABLE appointments (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ref TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  patient_id INTEGER REFERENCES patients(id),
  start_utc TEXT NOT NULL,
  end_utc TEXT NOT NULL,
  block_end_utc TEXT NOT NULL,      -- end + service buffer; used for overlap checks
  status TEXT NOT NULL CHECK (status IN ('held','pending_payment','confirmed','checked_in','completed','cancelled','no_show')),
  source TEXT NOT NULL CHECK (source IN ('web','reception','walk_in','waitlist')),
  hold_expires_at TEXT,
  pay_method TEXT CHECK (pay_method IN ('card','wallet','kiosk','clinic')),
  deposit_amount INTEGER NOT NULL DEFAULT 0,
  deposit_status TEXT NOT NULL DEFAULT 'none' CHECK (deposit_status IN ('none','pending','paid','refund_due','refunded','credit','forfeited')),
  patient_confirmed_at TEXT,          -- tapped "تأكيد" on WhatsApp
  visit_label TEXT,                   -- short booking label shown at reception (not medical)
  admin_notes TEXT,                   -- administrative notes, not medical
  reminder_day_sent_at TEXT,
  reminder_2h_sent_at TEXT,
  checked_in_at TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancel_reason TEXT,
  lang TEXT NOT NULL DEFAULT 'ar',
  seed_key TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  CHECK (end_utc > start_utc AND block_end_utc >= end_utc),
  UNIQUE (tenant_id, seed_key)
);
CREATE INDEX appointments_provider_time ON appointments (provider_id, start_utc, block_end_utc);
CREATE INDEX appointments_tenant_day ON appointments (tenant_id, start_utc);

-- Database-level guarantee against double booking: no two blocking rows for the
-- same provider may overlap. Enforced on every insert and on every update that
-- changes time, provider or status, regardless of which code path writes.
CREATE TRIGGER appointments_no_overlap_insert
BEFORE INSERT ON appointments
WHEN NEW.status IN (${ACTIVE})
BEGIN
  SELECT RAISE(ABORT, 'SLOT_TAKEN') WHERE EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.provider_id = NEW.provider_id
      AND ${BLOCKING("a")}
      AND a.start_utc < NEW.block_end_utc
      AND a.block_end_utc > NEW.start_utc
  );
END;

CREATE TRIGGER appointments_no_overlap_update
BEFORE UPDATE OF start_utc, end_utc, block_end_utc, provider_id, status, hold_expires_at ON appointments
WHEN NEW.status IN (${ACTIVE})
BEGIN
  SELECT RAISE(ABORT, 'SLOT_TAKEN') WHERE EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.id <> NEW.id
      AND a.provider_id = NEW.provider_id
      AND ${BLOCKING("a")}
      AND a.start_utc < NEW.block_end_utc
      AND a.block_end_utc > NEW.start_utc
  );
END;

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'paymob',
  method TEXT NOT NULL CHECK (method IN ('card','wallet','kiosk')),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EGP',
  status TEXT NOT NULL CHECK (status IN ('initiated','paid','failed','refunded','needs_refund')),
  provider_ref TEXT,               -- Paymob transaction id
  provider_order_id TEXT,
  intention_id TEXT,
  kiosk_reference TEXT,
  raw_payload TEXT,                -- redacted webhook body
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX payments_appointment ON payments (appointment_id);

-- Idempotency for every inbound webhook (Paymob, WhatsApp)
CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  event_key TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (${NOW}),
  UNIQUE (provider, event_key)
);

CREATE TABLE waitlist_entries (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  provider_id INTEGER REFERENCES providers(id),
  service_id INTEGER REFERENCES services(id),
  branch_id INTEGER REFERENCES branches(id),
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  weekdays TEXT,                   -- e.g. "4" or "0,2,4"; NULL = any day
  after_min INTEGER,               -- earliest acceptable local start time
  pref_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','booked','removed')),
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE slot_offers (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_appointment_id INTEGER NOT NULL REFERENCES appointments(id),
  provider_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  service_id INTEGER NOT NULL,
  start_utc TEXT NOT NULL,
  end_utc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','taken','expired')),
  taken_by_appointment_id INTEGER REFERENCES appointments(id),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE slot_offer_recipients (
  id INTEGER PRIMARY KEY,
  offer_id INTEGER NOT NULL REFERENCES slot_offers(id) ON DELETE CASCADE,
  waitlist_entry_id INTEGER NOT NULL REFERENCES waitlist_entries(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','too_late','declined')),
  sent_at TEXT NOT NULL DEFAULT (${NOW}),
  responded_at TEXT
);

CREATE TABLE walk_ins (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','seen','left')),
  arrived_at TEXT NOT NULL DEFAULT (${NOW}),
  seed_key TEXT,
  UNIQUE (tenant_id, seed_key)
);

CREATE TABLE message_log (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email')),
  template TEXT NOT NULL,
  recipient TEXT NOT NULL,          -- masked
  lang TEXT NOT NULL,
  body TEXT NOT NULL,
  buttons TEXT,                     -- JSON [{id,title}]
  status TEXT NOT NULL CHECK (status IN ('queued','sent','simulated','delivered','read','failed','skipped_opt_out')),
  provider_message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX message_log_tenant ON message_log (tenant_id, created_at);

CREATE TABLE gallery_cases (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  caption_ar TEXT NOT NULL DEFAULT '',
  caption_en TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL,
  alt_ar TEXT NOT NULL DEFAULT '',
  alt_en TEXT NOT NULL DEFAULT '',
  patient_consent INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  author_en TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  text_lang TEXT NOT NULL DEFAULT 'ar',
  translation_en TEXT,
  rating INTEGER NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  source TEXT NOT NULL DEFAULT 'google',
  published_on TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

-- Free-form landing-page copy per tenant (hero, section intros, SEO strings)
CREATE TABLE content_blocks (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_ar TEXT NOT NULL,
  value_en TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','receptionist','doctor')),
  provider_id INTEGER REFERENCES providers(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX audit_log_tenant ON audit_log (tenant_id, created_at);
`,
  },
];
