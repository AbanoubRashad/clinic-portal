"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { DICT } from "@/i18n/dict";
import { dayNumber, digits, fmtClock, fmtDateShort, fmtDuration, fmtMoney, fmtMonthYear, fmtPrice, fmtRating, fmtTime, relativeDay, weekdayShort } from "@/i18n/format";
import type { Lang, PayMethod } from "@/clinic/types";

export interface BookingProps {
  lang: Lang;
  slug: string;
  clinicShort: string;
  homeHref: string;
  doneHref: string;
  privacyHref: string;
  today: string;
  holdMinutes: number;
  cancellationHours: number;
  defaultDeposit: number;
  allowClinic: boolean;
  allowKiosk: boolean;
  branches: { id: number; name: string; district: string }[];
  services: { id: number; name: string; duration: number; price: number; isFrom: boolean; deposit: number | null }[];
  providers: { id: number; name: string; role: string; rating: number | null; photo: string | null; female: boolean; serviceIds: number[]; branchIds: number[] }[];
  initial: { serviceId?: number; providerId?: number; branchId?: number; date?: string; start?: string };
}

type DayData = { date: string; slots: { start: string; startMin: number; available: boolean }[] };
type Hold = { token: string; ref: string; expiresAt: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(body.error ?? "generic"), { code: body.error ?? "generic" });
  return body;
}

export function BookingFlow(p: BookingProps) {
  const t = DICT[p.lang].booking;
  const L = p.lang;
  const P = `/api/public/${p.slug}`;

  const pickInitialBranch = () => {
    if (p.initial.branchId && p.branches.some((b) => b.id === p.initial.branchId)) return p.initial.branchId;
    const prov = p.providers.find((x) => x.id === p.initial.providerId);
    return prov?.branchIds[0] ?? p.branches[0]?.id ?? 0;
  };
  const [branchId, setBranchId] = useState<number>(pickInitialBranch);
  const [serviceId, setServiceId] = useState<number>(() => {
    if (p.initial.serviceId && p.services.some((s) => s.id === p.initial.serviceId)) return p.initial.serviceId;
    const prov = p.providers.find((x) => x.id === p.initial.providerId);
    return p.services.find((s) => !prov || prov.serviceIds.includes(s.id))?.id ?? p.services[0]?.id ?? 0;
  });
  const [providerId, setProviderId] = useState<number | null>(p.initial.providerId ?? null);
  const [step, setStep] = useState(1);
  const [nextByProvider, setNextByProvider] = useState<Record<number, string | null>>({});
  const [days, setDays] = useState<DayData[] | null>(null);
  const [date, setDate] = useState<string | null>(p.initial.date ?? null);
  const [start, setStart] = useState<string | null>(p.initial.start ?? null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<PayMethod>("wallet");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const autoAdvance = useRef(Boolean(p.initial.start && p.initial.providerId));

  const services = useMemo(() => p.services.filter((s) => p.providers.some((d) => d.serviceIds.includes(s.id) && d.branchIds.includes(branchId))), [p.services, p.providers, branchId]);
  const doctors = useMemo(() => p.providers.filter((d) => d.serviceIds.includes(serviceId) && d.branchIds.includes(branchId)), [p.providers, serviceId, branchId]);
  const service = p.services.find((s) => s.id === serviceId);
  const doctor = p.providers.find((d) => d.id === providerId);
  const branch = p.branches.find((b) => b.id === branchId);
  const deposit = service ? (service.deposit ?? p.defaultDeposit) : p.defaultDeposit;
  const payOptions: PayMethod[] = deposit > 0 ? (["card", "wallet", ...(p.allowKiosk ? ["kiosk"] : []), ...(p.allowClinic ? ["clinic"] : [])] as PayMethod[]) : ["clinic"];
  const effectiveMethod = payOptions.includes(method) ? method : payOptions[0]!;
  const dueNow = effectiveMethod === "clinic" ? 0 : deposit;

  // keep selections valid when filters change
  useEffect(() => {
    if (!services.some((s) => s.id === serviceId) && services[0]) setServiceId(services[0].id);
  }, [services, serviceId]);
  useEffect(() => {
    if (providerId && !doctors.some((d) => d.id === providerId)) setProviderId(null);
    if (!providerId && doctors.length === 1) setProviderId(doctors[0]!.id);
  }, [doctors, providerId]);

  // "available today / tomorrow" chips
  useEffect(() => {
    if (!serviceId || !branchId) return;
    let live = true;
    api<{ next: Record<number, string | null> }>(`${P}/next?service=${serviceId}&branch=${branchId}`)
      .then((r) => live && setNextByProvider(r.next))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [P, serviceId, branchId]);

  const loadDays = useCallback(async () => {
    if (!providerId) return;
    setDays(null);
    const r = await api<{ days: DayData[] }>(`${P}/availability?service=${serviceId}&provider=${providerId}&branch=${branchId}`);
    setDays(r.days);
    return r.days;
  }, [P, serviceId, providerId, branchId]);

  useEffect(() => {
    if (step !== 2) return;
    loadDays()
      .then((ds) => {
        if (!ds) return;
        setDate((cur) => {
          if (cur && ds.some((d) => d.date === cur)) return cur;
          return (ds.find((d) => d.slots.some((s) => s.available)) ?? ds[0])?.date ?? null;
        });
      })
      .catch(() => setError("generic"));
  }, [step, loadDays]);

  // deep link from "next available" card: jump straight to step 2 with the slot selected
  useEffect(() => {
    if (autoAdvance.current && providerId) {
      autoAdvance.current = false;
      setStep(2);
    }
  }, [providerId]);

  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  useEffect(() => {
    if (!hold) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hold]);

  const day = days?.find((d) => d.date === date) ?? null;
  const slot = day?.slots.find((s) => s.start === start && s.available) ?? null;
  const remaining = hold ? Math.max(0, Date.parse(hold.expiresAt) - now) : 0;
  const holdExpired = Boolean(hold) && remaining === 0;

  const releaseHold = useCallback(
    (h: Hold | null) => {
      if (h) fetch(`${P}/holds/${h.token}`, { method: "DELETE" }).catch(() => {});
    },
    [P],
  );

  async function next() {
    setError(null);
    if (step === 1) {
      if (!providerId) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!slot || !providerId) return;
      setBusy(true);
      try {
        releaseHold(hold);
        const h = await api<Hold>(`${P}/holds`, {
          method: "POST",
          body: JSON.stringify({ serviceId, providerId, branchId, start: slot.start, lang: L }),
        });
        setHold(h);
        setNow(Date.now());
        setStep(3);
      } catch (e) {
        setError((e as { code?: string }).code ?? "generic");
        setStart(null);
        await loadDays().catch(() => {});
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === 3 && hold) {
      if (holdExpired) {
        setError("HOLD_EXPIRED");
        return;
      }
      setBusy(true);
      try {
        const r = await api<{ kind: "confirmed" | "redirect"; url?: string; token: string }>(`${P}/holds/${hold.token}/complete`, {
          method: "POST",
          body: JSON.stringify({ name, phone, method: effectiveMethod, marketingConsent: consent, lang: L, donePath: p.doneHref }),
        });
        window.location.assign(r.kind === "redirect" && r.url ? r.url : `${p.doneHref}?t=${r.token}`);
      } catch (e) {
        const code = (e as { code?: string }).code ?? "generic";
        setError(code);
        if (code === "HOLD_EXPIRED" || code === "SLOT_TAKEN") {
          setHold(null);
          setStart(null);
          setStep(2);
        }
        setBusy(false);
      }
    }
  }

  function back() {
    setError(null);
    if (step === 1) {
      window.location.assign(p.homeHref);
      return;
    }
    if (step === 3) {
      releaseHold(hold);
      setHold(null);
    }
    setStep(step - 1);
  }

  const availabilityChip = (id: number, female: boolean) => {
    if (!(id in nextByProvider)) return null;
    const d = nextByProvider[id];
    if (!d) return t.available.none;
    if (d === p.today) return t.available.today(female);
    const rel = relativeDay(d, p.today, L);
    if (rel === (L === "ar" ? "بكرة" : "tomorrow")) return t.available.tomorrow(female);
    return t.available.day(female, L === "ar" ? rel : weekdayShort(d, L));
  };

  const canNext = step === 1 ? Boolean(providerId) : step === 2 ? Boolean(slot) : step === 3 ? name.trim().length >= 3 && phone.trim().length >= 10 && !holdExpired : false;
  const mmss = `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;
  const ctaLabel = step === 3 ? (effectiveMethod === "clinic" ? t.confirm : t.payAndConfirm) : t.next;
  const summary =
    step === 1
      ? service
        ? `${service.name} · ${fmtDuration(service.duration, L, true)}`
        : ""
      : step === 2
        ? date
          ? `${weekdayShort(date, L)} ${dayNumber(date, L)} · ${slot ? fmtClock(slot.startMin, L) : t.pickTime}`
          : t.pickTime
        : fmtMoney(dueNow, L);

  return (
    <div className="bk">
      <div className="bk-shell">
        <div className="bk-head">
          <div className="bk-head-row">
            <button type="button" className="icon-btn" onClick={back} aria-label={t.back}>
              <Icon name="back" size={20} strokeWidth={2} className="flip-ltr" />
            </button>
            <div className="bk-title">
              <h1 ref={headingRef} tabIndex={-1} style={{ margin: 0, fontSize: 17, fontWeight: 800, outline: "none" }}>
                {t.titles[step - 1]}
              </h1>
              <span>
                {p.clinicShort} · {t.step(step)}
              </span>
            </div>
            <div style={{ width: 44 }} />
          </div>
          <div className="bk-progress" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step} aria-label={t.step(step)}>
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={i <= step ? "on" : ""} />
            ))}
          </div>
        </div>

        <div className="bk-body">
          {error ? (
            <div className="alert alert-error" role="alert">
              {t.errors[error] ?? t.errors.generic}
            </div>
          ) : null}

          {step === 1 ? (
            <>
              {p.branches.length > 1 ? (
                <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                  <legend className="bk-label" style={{ padding: 0, marginBottom: 12 }}>
                    {t.branch}
                  </legend>
                  <div className="chips">
                    {p.branches.map((b) => (
                      <button key={b.id} type="button" className="chip-btn" aria-pressed={b.id === branchId} onClick={() => setBranchId(b.id)}>
                        {b.district}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="bk-label" style={{ padding: 0, marginBottom: 12 }}>
                  {t.service}
                </legend>
                <div className="chips">
                  {services.map((s) => (
                    <button key={s.id} type="button" className="chip-btn" aria-pressed={s.id === serviceId} onClick={() => setServiceId(s.id)}>
                      {s.name} · {fmtDuration(s.duration, L, true)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset style={{ border: 0, padding: 0, margin: "6px 0 0", display: "flex", flexDirection: "column", gap: 12 }}>
                <legend className="bk-label" style={{ padding: 0, marginBottom: 12 }}>
                  {t.doctor}
                </legend>
                {doctors.map((d) => {
                  const chip = availabilityChip(d.id, d.female);
                  return (
                    <button key={d.id} type="button" className="doc-btn" aria-pressed={d.id === providerId} onClick={() => setProviderId(d.id)}>
                      {d.photo ? <img src={d.photo} alt="" width={64} height={72} /> : null}
                      <span className="info">
                        <strong>{d.name}</strong>
                        <span className="r">{d.role}</span>
                        <span className="tags">
                          {d.rating ? <span className="chip chip-rating">★ {fmtRating(d.rating, L)}</span> : null}
                          {chip ? <span className="chip chip-tint">{chip}</span> : null}
                        </span>
                      </span>
                      <span className="radio-dot" aria-hidden="true" />
                    </button>
                  );
                })}
              </fieldset>
            </>
          ) : null}

          {step === 2 && doctor ? (
            <>
              <div className="summary-card">
                {doctor.photo ? <img src={doctor.photo} alt="" width={48} height={48} /> : null}
                <div className="t">
                  <strong>{doctor.name}</strong>
                  <span>
                    {service?.name} · {branch?.name}
                  </span>
                </div>
              </div>
              <div className="bk-row-between">
                <span className="bk-label" id="day-label">
                  {t.pickDay}
                </span>
                <span className="small">{date ? fmtMonthYear(date, L) : ""}</span>
              </div>
              {days === null ? (
                <div className="days-strip" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="skeleton" style={{ height: 72 }} />
                  ))}
                </div>
              ) : days.length === 0 ? (
                <div className="alert alert-info">{t.noDays}</div>
              ) : (
                <div className="days-strip" role="group" aria-labelledby="day-label">
                  {days.map((d) => {
                    const full = !d.slots.some((s) => s.available);
                    return (
                      <button
                        key={d.date}
                        type="button"
                        className={`day-btn${full ? " full" : ""}`}
                        aria-pressed={d.date === date}
                        aria-label={fmtDateShort(d.date, L)}
                        onClick={() => {
                          setDate(d.date);
                          setStart(null);
                        }}
                      >
                        <span>{weekdayShort(d.date, L)}</span>
                        <strong>{dayNumber(d.date, L)}</strong>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="bk-label" id="slots-label">
                {t.slots}
              </div>
              {days === null ? (
                <div className="slots" aria-hidden="true">
                  {Array.from({ length: 9 }, (_, i) => (
                    <div key={i} className="skeleton" style={{ height: 46 }} />
                  ))}
                </div>
              ) : day && day.slots.some((s) => s.available) ? (
                <div className="slots" role="group" aria-labelledby="slots-label">
                  {day.slots.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      className="slot-btn"
                      disabled={!s.available}
                      aria-pressed={s.start === start}
                      aria-label={`${fmtTime(s.startMin, L)}${s.available ? "" : L === "ar" ? " (محجوز)" : " (taken)"}`}
                      onClick={() => setStart(s.start)}
                    >
                      {fmtClock(s.startMin, L)}
                    </button>
                  ))}
                </div>
              ) : day ? (
                <div className="alert alert-info">{t.noSlots}</div>
              ) : null}
              <div className="small">{t.slotsNote(digits(p.holdMinutes, L))}</div>
            </>
          ) : null}

          {step === 3 && doctor && slot && date ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (canNext && !busy) void next();
              }}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
              noValidate
            >
              <div className="summary-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 4, padding: 14 }}>
                <strong>
                  {service?.name} · {doctor.name}
                </strong>
                <span className="small" style={{ fontSize: 14 }}>
                  {fmtDateShort(date, L)} · {L === "ar" ? "الساعة " : ""}
                  {fmtTime(slot.startMin, L)} · {branch?.name}
                </span>
              </div>
              {hold && !holdExpired ? (
                <div className="alert alert-info" aria-live="polite">
                  <Icon name="clock" size={18} style={{ verticalAlign: "middle", marginInlineEnd: 6 }} />
                  {t.holdLeft(digits(mmss, L))}
                </div>
              ) : holdExpired ? (
                <div className="alert alert-error" role="alert">
                  {t.holdExpired}
                </div>
              ) : null}
              <label className="field">
                {t.name}
                <input name="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error === "INVALID_NAME"} />
              </label>
              <label className="field">
                {t.phone}
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  dir="ltr"
                  required
                  placeholder="01xxxxxxxxx"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-invalid={error === "INVALID_PHONE"}
                  aria-describedby="phone-hint"
                  style={{ textAlign: L === "ar" ? "right" : "left" }}
                />
                <span className="hint" id="phone-hint">
                  {t.phoneHint}
                </span>
              </label>
              {deposit > 0 ? (
                <fieldset style={{ border: 0, padding: 0, margin: "4px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
                  <legend style={{ fontWeight: 800, padding: 0, marginBottom: 8 }}>{t.payTitle}</legend>
                  {payOptions.map((m) => (
                    <button key={m} type="button" className="pay-btn" aria-pressed={m === effectiveMethod} onClick={() => setMethod(m)}>
                      <span>{t.pay[m]}</span>
                      <span className="radio-dot" aria-hidden="true" />
                    </button>
                  ))}
                </fieldset>
              ) : null}
              <div className="price-box">
                <div>
                  <span className="muted">{t.servicePrice}</span>
                  <span>{service ? fmtPrice(service.price, service.isFrom, L) : ""}</span>
                </div>
                <div className="total">
                  <span>{t.depositNow}</span>
                  <span>{fmtMoney(dueNow, L)}</span>
                </div>
              </div>
              {deposit > 0 ? (
                <div className="info-box">
                  <Icon name="shield" size={24} stroke="var(--primary)" />
                  <div>{t.depositNote(fmtMoney(deposit, L), digits(p.cancellationHours, L))}</div>
                </div>
              ) : null}
              <label className="check">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>{t.consent}</span>
              </label>
              <div className="small">
                {t.privacyAgree}{" "}
                <a href={p.privacyHref} target="_blank" rel="noopener">
                  {t.privacyLink}
                </a>
                .
              </div>
              <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
            </form>
          ) : null}
        </div>

        <div className="bk-cta">
          <div className="sum">
            <span>{t.ctaHint[step - 1]}</span>
            <strong>{summary}</strong>
          </div>
          <button type="button" onClick={() => void next()} disabled={!canNext || busy} aria-busy={busy}>
            {busy ? "…" : ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

