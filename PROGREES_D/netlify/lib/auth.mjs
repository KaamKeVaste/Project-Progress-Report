import crypto from "node:crypto";

export function sha(s) { return crypto.createHash("sha256").update(String(s)).digest(); }
export function hexSha(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }

// Constant-time comparison that does not leak length.
export function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha(a), sha(b));
}

export function sessionSecret() {
  const s = process.env.SESSION_SECRET || "";
  return s.length >= 32 ? s : null; // fail closed when not configured
}

export function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return body + "." + mac;
}
export function verify(token, secret) {
  if (typeof token !== "string" || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expect = crypto.createHmac("sha256", secret).update(parts[0]).digest("base64url");
  const a = Buffer.from(parts[1]), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (typeof p.exp !== "number" || p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
export const COOKIE = "kwsess";
export const SESSION_SECONDS = 30 * 60;
export function setCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function projectCode(raw) {
  const c = String(raw || "").trim().toUpperCase();
  return /^[A-Z0-9]{2,12}$/.test(c) ? c : null;
}

// ---- brute-force protection (counts failures per key inside a time window)
const WINDOW_MS = 15 * 60 * 1000;
export async function isLocked(store, key, limit) {
  const rec = await store.get(key, { type: "json" });
  if (!rec) return false;
  if (Date.now() - rec.t0 > WINDOW_MS) return false;
  return rec.n >= limit;
}
export async function addFail(store, key) {
  const rec = await store.get(key, { type: "json" });
  const now = Date.now();
  if (!rec || now - rec.t0 > WINDOW_MS) await store.setJSON(key, { n: 1, t0: now });
  else await store.setJSON(key, { n: rec.n + 1, t0: rec.t0 });
}
export async function clearFails(store, key) { try { await store.delete(key); } catch {} }
