import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Icon } from "@/components/Icon";
import { get } from "@/lib/db";
import { secret } from "@/lib/crypto";
import { computeTransactionHmac, paymobConfigFromEnv, sandboxTransaction, type PaymobMethod } from "@/payments/paymob";
import { apptView } from "@/clinic/notifications";
import { appointmentByPublicToken } from "@/clinic/repo";
import { fmtDateShort, fmtMoney, fmtTime } from "@/i18n/format";
import { db } from "@/server/db";
import { originOf } from "@/server/tenant";

export const dynamic = "force-dynamic";

interface PaymentRow {
  id: number;
  appointment_id: number;
  method: PaymobMethod;
  amount_cents: number;
  status: string;
  provider_order_id: string;
  kiosk_reference: string | null;
}

const safePath = (v: unknown) => (typeof v === "string" && /^\/(?!\/)[\w\-/]*$/.test(v) ? v : "/book/done");

function load(p: string | undefined, t: string | undefined) {
  // The sandbox only exists when no real Paymob account is configured.
  if (paymobConfigFromEnv() || !p || !t) notFound();
  const appt = appointmentByPublicToken(db(), t);
  const pay = get<PaymentRow>(db(), "SELECT * FROM payments WHERE id = ?", Number(p));
  if (!appt || !pay || pay.appointment_id !== appt.id) notFound();
  return { appt, pay };
}

/** Plays Paymob's part: builds the transaction callback, signs it with the HMAC secret and POSTs it to our webhook. */
async function simulate(form: FormData) {
  "use server";
  const { appt, pay } = load(String(form.get("p")), String(form.get("t")));
  const outcome = String(form.get("outcome"));
  const txn = sandboxTransaction({
    id: Date.now(),
    orderId: 900000 + pay.id,
    merchantOrderId: pay.provider_order_id,
    amountCents: pay.amount_cents,
    method: pay.method,
    success: outcome === "success",
    pending: outcome === "kiosk_ref",
    billReference: outcome === "kiosk_ref" ? String(70000000 + pay.id * 37) : undefined,
  });
  const hmac = computeTransactionHmac(txn, secret("PAYMOB_HMAC_SECRET"));
  const origin = originOf(await headers());
  const res = await fetch(`${origin}/api/payments/paymob/webhook?hmac=${hmac}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "TRANSACTION", obj: txn }),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
  // Like Paymob's redirection: the browser comes back to the confirmation page, which never confirms anything itself.
  redirect(`${safePath(form.get("r"))}?t=${appt.public_token}`);
}

export default async function SandboxCheckout({ searchParams }: { searchParams: Promise<{ p?: string; t?: string; r?: string }> }) {
  const { p, t, r } = await searchParams;
  const { appt, pay } = load(p, t);
  const v = apptView(db(), appt);
  const done = pay.status !== "initiated" || !["pending_payment", "held"].includes(appt.status);
  const methodLabel = { card: "بطاقة بنكية", wallet: "محفظة موبايل (فودافون كاش)", kiosk: "فوري / منفذ دفع" }[pay.method];
  const Btn = ({ outcome, label, tone = "primary" }: { outcome: string; label: string; tone?: string }) => (
    <form action={simulate}>
      <input type="hidden" name="p" value={pay.id} />
      <input type="hidden" name="t" value={appt.public_token} />
      <input type="hidden" name="r" value={r ?? ""} />
      <input type="hidden" name="outcome" value={outcome} />
      <button className={`btn btn-block ${tone === "primary" ? "btn-primary" : "btn-outline"}`} style={{ borderRadius: 14, minHeight: 52 }} type="submit">
        {label}
      </button>
    </form>
  );

  return (
    <main className="login">
      <div className="panel" style={{ maxWidth: 440 }}>
        <div className="flash" style={{ background: "var(--chip)", color: "var(--chip-ink)", fontSize: 14 }}>
          صفحة دفع تجريبية: بتحاكي Paymob على الجهاز ده بس. مفيش فلوس حقيقية.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="brand-mark" style={{ width: 40, height: 40, borderRadius: 12 }}>
            <Icon name={pay.method === "card" ? "card" : pay.method === "wallet" ? "chat" : "list"} stroke="#fff" size={20} />
          </span>
          <div>
            <strong style={{ display: "block" }}>دفع عربون · {v.tenant.name_ar}</strong>
            <span className="muted" style={{ fontSize: 14 }}>
              {methodLabel}
            </span>
          </div>
        </div>
        <div className="price-box" style={{ background: "var(--ground)" }}>
          <div>
            <span className="muted">الحجز</span>
            <span dir="ltr">{appt.ref}</span>
          </div>
          <div>
            <span className="muted">الموعد</span>
            <span>
              {fmtDateShort(v.local.date, "ar")} · {fmtTime(v.local.minutes, "ar")}
            </span>
          </div>
          <div className="total">
            <span>المبلغ</span>
            <span>{fmtMoney(pay.amount_cents / 100, "ar")}</span>
          </div>
        </div>
        {done && !(pay.method === "kiosk" && pay.kiosk_reference && appt.status === "pending_payment") ? (
          <div className="flash ok">العملية دي اتقفلت بالفعل.</div>
        ) : pay.method === "kiosk" ? (
          pay.kiosk_reference ? (
            <>
              <div>
                رقمك المرجعي: <strong dir="ltr">{pay.kiosk_reference}</strong>
              </div>
              <Btn outcome="success" label="محاكاة: العميل دفع في المنفذ" />
            </>
          ) : (
            <Btn outcome="kiosk_ref" label="إصدار رقم مرجعي" />
          )
        ) : (
          <>
            <Btn outcome="success" label="ادفع (عملية ناجحة)" />
            <Btn outcome="declined" label="رفض العملية" tone="outline" />
          </>
        )}
      </div>
    </main>
  );
}
