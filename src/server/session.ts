import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { get } from "@/lib/db";
import { hmacHex, safeEqualHex, secret } from "@/lib/crypto";
import { tenantById } from "@/clinic/repo";
import type { Role, Tenant } from "@/clinic/types";
import type { Actor } from "@/clinic/audit";
import { db } from "./db";

const COOKIE = "cp_session";
const TTL_MS = 12 * 3_600_000; // one clinic shift

export interface SessionUser {
  id: number;
  tenant_id: number;
  name: string;
  email: string;
  role: Role;
  provider_id: number | null;
}

function sign(payload: string) {
  return hmacHex("sha256", secret("SESSION_SECRET"), payload);
}

export async function createSession(userId: number) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + TTL_MS })).toString("base64url");
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_MS / 1000,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEqualHex(sign(payload), sig)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid: number; exp: number };
    if (exp < Date.now()) return null;
    return get<SessionUser>(db(), "SELECT id, tenant_id, name, email, role, provider_id FROM users WHERE id = ? AND active = 1", uid) ?? null;
  } catch {
    return null;
  }
}

/** For pages and server actions: redirects to /login when signed out, 403s on a missing role. */
export async function requireStaff(roles: Role[] = ["owner", "receptionist", "doctor"]): Promise<{ user: SessionUser; tenant: Tenant; actor: Actor }> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!roles.includes(user.role)) redirect("/dashboard?denied=1");
  const tenant = tenantById(db(), user.tenant_id)!;
  return { user, tenant, actor: { userId: user.id, name: user.name } };
}

export const ROLE_LABEL: Record<Role, string> = { owner: "مالك العيادة", receptionist: "موظفة استقبال", doctor: "طبيب" };
