export type Lang = "ar" | "en";
export type Vertical = "dental" | "derma" | "physio" | "salon" | "vet" | "legal";
export type AppointmentStatus = "held" | "pending_payment" | "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show";
export type PayMethod = "card" | "wallet" | "kiosk" | "clinic";
export type Role = "owner" | "receptionist" | "doctor";

export interface Tenant {
  id: number;
  slug: string;
  custom_domain: string | null;
  name_ar: string;
  name_en: string;
  short_name_ar: string;
  short_name_en: string;
  tagline_ar: string;
  tagline_en: string;
  logo_url: string | null;
  primary_color: string;
  ref_prefix: string;
  vertical: Vertical;
  timezone: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  google_rating: number | null;
  google_reviews_count: number | null;
  google_reviews_url: string | null;
  years_experience: number | null;
  deposit_amount: number;
  deposits_enabled_at: string | null;
  allow_pay_at_clinic: number;
  allow_kiosk: number;
  cancellation_window_hours: number;
  min_notice_minutes: number;
  slot_step_minutes: number;
  booking_horizon_days: number;
  hold_minutes: number;
  reminder_hour: number;
  reminder_2h_enabled: number;
  whatsapp_phone_number_id: string | null;
  demo: number;
}

export interface Branch {
  id: number;
  tenant_id: number;
  slug: string;
  name_ar: string;
  name_en: string;
  district_ar: string;
  district_en: string;
  address_ar: string;
  address_en: string;
  lat: number | null;
  lng: number | null;
  google_place_id: string | null;
  phone: string | null;
  sort: number;
}

export interface BranchHours {
  id: number;
  branch_id: number;
  weekday: number;
  open_min: number;
  close_min: number;
}

export interface Provider {
  id: number;
  tenant_id: number;
  slug: string;
  name_ar: string;
  name_en: string;
  short_ar: string;
  short_en: string;
  title_ar: string;
  title_en: string;
  specialty_ar: string;
  specialty_en: string;
  bio_ar: string;
  bio_en: string;
  gender: "m" | "f";
  photo_url: string | null;
  rating: number | null;
  years_experience: number | null;
  active: number;
  sort: number;
}

export interface Service {
  id: number;
  tenant_id: number;
  slug: string;
  name_ar: string;
  name_en: string;
  desc_ar: string;
  desc_en: string;
  duration_min: number;
  buffer_min: number;
  price_egp: number;
  price_is_from: number;
  deposit_egp: number | null;
  active: number;
  show_on_landing: number;
  sort: number;
}

export interface WorkingHours {
  id: number;
  provider_id: number;
  branch_id: number;
  weekday: number;
  start_min: number;
  end_min: number;
}

export interface Appointment {
  id: number;
  tenant_id: number;
  ref: string;
  public_token: string;
  branch_id: number;
  provider_id: number;
  service_id: number;
  patient_id: number | null;
  start_utc: string;
  end_utc: string;
  block_end_utc: string;
  status: AppointmentStatus;
  source: "web" | "reception" | "walk_in" | "waitlist";
  hold_expires_at: string | null;
  pay_method: PayMethod | null;
  deposit_amount: number;
  deposit_status: "none" | "pending" | "paid" | "refund_due" | "refunded" | "credit" | "forfeited";
  patient_confirmed_at: string | null;
  visit_label: string | null;
  admin_notes: string | null;
  reminder_day_sent_at: string | null;
  reminder_2h_sent_at: string | null;
  checked_in_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  lang: Lang;
  created_at: string;
}

export interface Patient {
  id: number;
  tenant_id: number;
  name: string;
  phone_enc: string;
  phone_hash: string;
  phone_last4: string;
  email: string | null;
  lang: Lang;
  marketing_consent: number;
  whatsapp_opt_out: number;
}

export interface Review {
  id: number;
  author: string;
  author_en: string;
  text: string;
  text_lang: string;
  translation_en: string | null;
  rating: number;
  source: string;
  published_on: string;
  sort: number;
}

export interface GalleryCase {
  id: number;
  title_ar: string;
  title_en: string;
  caption_ar: string;
  caption_en: string;
  image_url: string;
  alt_ar: string;
  alt_en: string;
  patient_consent: number;
  sort: number;
}

/** Picks the field for the language: L(row, "name", "en") -> row.name_en */
export function L<T extends object>(row: T, field: string, lang: Lang): string {
  const r = row as Record<string, unknown>;
  return String(r[`${field}_${lang}`] ?? r[`${field}_ar`] ?? "");
}
