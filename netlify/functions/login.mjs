// POST /api/login  - viewer enters the password of ONE project.
import { safeEqual, hexSha, isLocked, addFail, clearFails, sign, sessionSecret, setCookie, projectCode, SESSION_SECONDS } from "../lib/auth.mjs";
import { html, pageShell } from "../lib/util.mjs";
import { loginPage } from "../lib/pages.mjs";
import { locks, audit } from "../lib/store.mjs";

export default async (req, context) => {
  if (req.method !== "POST") return new Response(null, { status: 303, headers: { Location: "/" } });
  const secret = sessionSecret();
  const form = await req.formData().catch(() => null);
  const code = projectCode(form?.get("project"));
  const password = String(form?.get("password") ?? "").slice(0, 200);
  if (!code) return html(pageShell("Not found", "<h1>Not found</h1><p>Use the link you were given.</p>"), 404);
  if (!secret) return html(loginPage(code, "This website is not configured yet."), 500);

  const ip = context?.ip || "unknown";
  const ipKey = "login-" + hexSha(ip + "|" + code).slice(0, 24);
  const projKey = "loginp-" + code;
  const L = locks();
  if ((await isLocked(L, ipKey, 5)) || (await isLocked(L, projKey, 30))) {
    await audit("login_locked", { project: code, ip: hexSha(ip).slice(0, 12) });
    return html(loginPage(code, "Too many wrong attempts. Please wait 15 minutes and try again."), 429);
  }

  const expected = process.env["PW_" + code] || "";
  const ok = expected.length >= 8 && safeEqual(password, expected);
  if (!ok) {
    await addFail(L, ipKey); await addFail(L, projKey);
    await audit("login_fail", { project: code, ip: hexSha(ip).slice(0, 12) });
    return html(loginPage(code, "Incorrect password."), 401);
  }
  await clearFails(L, ipKey);
  await audit("login_ok", { project: code, ip: hexSha(ip).slice(0, 12) });
  const token = sign({ p: code, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS }, secret);
  return new Response(null, { status: 303, headers: {
    Location: `/p/${code}`, "Set-Cookie": setCookie(token, SESSION_SECONDS), "Cache-Control": "no-store" } });
};
export const config = { path: "/api/login" };
