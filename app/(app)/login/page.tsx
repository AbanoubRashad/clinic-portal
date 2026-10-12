import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Icon } from "@/components/Icon";
import { get } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { audit } from "@/clinic/audit";
import { db } from "@/server/db";
import { createSession, currentUser } from "@/server/session";

async function login(form: FormData) {
  "use server";
  const ip = clientIp(await headers());
  if (!rateLimit(`login:${ip}`, 10, 10 * 60_000).ok) redirect("/login?e=rate");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const user = get<{ id: number; tenant_id: number; name: string; password_hash: string }>(
    db(),
    "SELECT id, tenant_id, name, password_hash FROM users WHERE email = ? AND active = 1",
    email,
  );
  if (!user || !verifyPassword(password, user.password_hash)) redirect("/login?e=bad");
  await createSession(user.id);
  audit(db(), user.tenant_id, { userId: user.id, name: user.name }, "user.login", "user", user.id);
  redirect("/dashboard");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  if (await currentUser()) redirect("/dashboard");
  return (
    <main className="login">
      <form className="panel" action={login}>
        <div className="dash-brand" style={{ padding: 0 }}>
          <span className="brand-mark">
            <Icon name="tooth" stroke="#fff" size={20} />
          </span>
          <div>
            <strong>تسجيل دخول فريق العيادة</strong>
            <span>لوحة الاستقبال والإدارة</span>
          </div>
        </div>
        {e ? (
          <div className="flash err" role="alert">
            {e === "rate" ? "محاولات كتير، استنى شوية وجرّب تاني." : "الإيميل أو كلمة المرور غير صحيحة."}
          </div>
        ) : null}
        <label className="field">
          البريد الإلكتروني
          <input name="email" type="email" autoComplete="username" required dir="ltr" />
        </label>
        <label className="field">
          كلمة المرور
          <input name="password" type="password" autoComplete="current-password" required dir="ltr" />
        </label>
        <button className="btn btn-primary" type="submit" style={{ borderRadius: 12 }}>
          دخول
        </button>
      </form>
    </main>
  );
}
