import type { Lang } from "@/clinic/types";
import { addDays, utcToZoned } from "@/booking-engine/time";

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function digits(v: string | number, lang: Lang): string {
  const s = String(v);
  return lang === "ar" ? s.replace(/\d/g, (d) => AR_DIGITS[Number(d)]!) : s;
}

export function fmtNumber(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: 1 }).format(n);
}

/** 4.9 -> "٤٫٩" / "4.9" (always one decimal, as on Google) */
export function fmtRating(n: number | null, lang: Lang): string {
  if (n == null) return "";
  return new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
}

export function fmtPrice(egp: number, isFrom: boolean | number, lang: Lang): string {
  const n = fmtNumber(egp, lang);
  if (lang === "ar") return `${isFrom ? "من " : ""}${n} ج.م`;
  return `${isFrom ? "From " : ""}EGP ${n}`;
}

export function fmtMoney(egp: number, lang: Lang): string {
  return lang === "ar" ? `${fmtNumber(egp, lang)} ج.م` : `EGP ${fmtNumber(egp, lang)}`;
}

export function fmtDuration(min: number, lang: Lang, short = false): string {
  if (lang === "ar") return `${digits(min, lang)} ${short ? "د" : "دقيقة"}`;
  return `${min} min`;
}

/** minutes after midnight -> "٥:٣٠" (no suffix) */
export function fmtClock(minutes: number, lang: Lang): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return digits(`${h}:${String(m).padStart(2, "0")}`, lang);
}

export function amPm(minutes: number, lang: Lang): string {
  const pm = Math.floor(minutes / 60) % 24 >= 12;
  return lang === "ar" ? (pm ? "م" : "ص") : pm ? "PM" : "AM";
}

export function fmtTime(minutes: number, lang: Lang): string {
  return `${fmtClock(minutes, lang)} ${amPm(minutes, lang)}`;
}

/** "12 ظهرًا", "10 مساءً", "9 صباحًا" — used in opening hours */
export function fmtHourWords(minutes: number, lang: Lang): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const hm = m ? `${h}:${String(m).padStart(2, "0")}` : `${h}`;
  if (lang === "en") return `${hm} ${h24 >= 12 ? "pm" : "am"}`;
  const word = h24 < 12 ? "صباحًا" : h24 < 16 ? "ظهرًا" : "مساءً";
  return `${digits(hm, lang)} ${word}`;
}

export const WEEKDAYS: Record<Lang, string[]> = {
  ar: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};
export const WEEKDAYS_SHORT: Record<Lang, string[]> = {
  ar: ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
export const MONTHS: Record<Lang, string[]> = {
  ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

/** Egyptian week starts on Saturday. */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];

function parts(localDate: string) {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "الثلاثاء ٦ أكتوبر ٢٠٢٦" / "Tuesday 6 October 2026" */
export function fmtDateLong(localDate: string, lang: Lang, withYear = true): string {
  const p = parts(localDate);
  const s = `${WEEKDAYS[lang][p.wd]} ${digits(p.d, lang)} ${MONTHS[lang][p.m - 1]}${withYear ? " " + digits(p.y, lang) : ""}`;
  return s;
}

/** "سبت ١٠ أكتوبر" */
export function fmtDateShort(localDate: string, lang: Lang): string {
  const p = parts(localDate);
  return `${WEEKDAYS_SHORT[lang][p.wd]} ${digits(p.d, lang)} ${MONTHS[lang][p.m - 1]}`;
}

export function fmtMonthYear(localDate: string, lang: Lang): string {
  const p = parts(localDate);
  return `${MONTHS[lang][p.m - 1]} ${digits(p.y, lang)}`;
}

export function dayNumber(localDate: string, lang: Lang): string {
  return digits(parts(localDate).d, lang);
}

export function weekdayShort(localDate: string, lang: Lang): string {
  return WEEKDAYS_SHORT[lang][parts(localDate).wd]!;
}

/** "النهارده" / "بكرة" / weekday name */
export function relativeDay(localDate: string, today: string, lang: Lang): string {
  if (localDate === today) return lang === "ar" ? "النهارده" : "today";
  if (localDate === addDays(today, 1)) return lang === "ar" ? "بكرة" : "tomorrow";
  return lang === "ar" ? WEEKDAYS[lang][parts(localDate).wd]! : `on ${WEEKDAYS[lang][parts(localDate).wd]}`;
}

export function localTimeOf(iso: string, tz: string) {
  return utcToZoned(new Date(iso), tz);
}

/** Sorted weekday list -> "السبت · الإثنين · الأربعاء" */
export function fmtWeekdays(days: number[], lang: Lang): string {
  const set = new Set(days);
  return WEEK_ORDER.filter((d) => set.has(d))
    .map((d) => WEEKDAYS[lang][d])
    .join(" · ");
}

/** Groups equal opening hours over consecutive days: "السبت – الخميس · ١٢ ظهرًا – ١٠ مساءً" */
export function fmtOpeningHours(hours: { weekday: number; open_min: number; close_min: number }[], lang: Lang): string[] {
  const byDay = new Map(hours.map((h) => [h.weekday, h]));
  const groups: { days: number[]; open: number; close: number }[] = [];
  for (const d of WEEK_ORDER) {
    const h = byDay.get(d);
    if (!h) continue;
    const last = groups[groups.length - 1];
    const prevDay = last?.days[last.days.length - 1];
    const consecutive = prevDay !== undefined && WEEK_ORDER.indexOf(d) === WEEK_ORDER.indexOf(prevDay) + 1;
    if (last && consecutive && last.open === h.open_min && last.close === h.close_min) last.days.push(d);
    else groups.push({ days: [d], open: h.open_min, close: h.close_min });
  }
  return groups.map((g) => {
    const first = WEEKDAYS[lang][g.days[0]!];
    const lastD = WEEKDAYS[lang][g.days[g.days.length - 1]!];
    const range = g.days.length > 1 ? `${first} – ${lastD}` : first;
    return `${range} · ${fmtHourWords(g.open, lang)} – ${fmtHourWords(g.close, lang)}`;
  });
}
