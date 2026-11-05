// /admin        GET  - form for adding or updating a project (no code change, no redeploy).
// /api/admin    POST - needs ADMIN_KEY. Saves the project and shows its project key for the workbook's _config sheet.
import crypto from "node:crypto";
import { safeEqual, hexSha, isLocked, addFail, clearFails } from "../lib/auth.mjs";
import { html, esc } from "../lib/util.mjs";
import { locks, audit, registryStore } from "../lib/store.mjs";
import { getProject, projectKey, hashPassword, CODE_RE, TOKEN_RE } from "../lib/registry.mjs";
import { adminPage, adminResult } from "../lib/pages.mjs";

const MAX_LOGO = 300_000;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export default async (req, context) => {
  const adminKey = process.env.ADMIN_KEY || "";
  if (adminKey.length < 24) return html(adminPage("The admin page is switched off. Add the ADMIN_KEY variable (24+ characters) in Netlify and redeploy."), 503);
  if (req.method === "GET") return html(adminPage(""));
  if (req.method !== "POST") return html(adminPage(""), 405);

  const ip = context?.ip || "unknown";
  const lock = "admin-" + hexSha(ip).slice(0, 24);
  const L = locks();
  if (await isLocked(L, lock, 5)) return html(adminPage("Too many wrong admin keys. Wait 15 minutes."), 429);

  const len = +(req.headers.get("content-length") || 0);
  if (len > MAX_LOGO * 2) return html(adminPage("The upload is too large. Use a logo PNG under 300 KB."), 413);
  const form = await req.formData().catch(() => null);
  if (!form) return html(adminPage("The form could not be read."), 400);
  if (!safeEqual(String(form.get("admin_key") ?? ""), adminKey)) {
    await addFail(L, lock); await audit("admin_fail", { ip: hexSha(ip).slice(0, 12) });
    return html(adminPage("Wrong admin key."), 401);
  }
  await clearFails(L, lock);

  const action = String(form.get("action") ?? "save");
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  if (!CODE_RE.test(code)) return html(adminPage("Project code must be 2–12 capital letters or digits, exactly as in the workbook title (for example AGV1)."), 400);
  const existing = await getProject(code);

  if (action === "key") {
    if (!existing) return html(adminPage(`Project ${code} is not registered yet.`), 404);
    return html(adminResult(code, projectKey(code), false, existing.source));
  }

  const token = String(form.get("client_token") ?? "").trim().toUpperCase();
  if (!TOKEN_RE.test(token) || token.length > 40) return html(adminPage("Client name must be the word(s) used in the workbook title after “PROJECT :”, for example AMGEN."), 400);
  const pw = String(form.get("password") ?? "");
  if (pw && (pw.length < 10 || pw.length > 200)) return html(adminPage("Viewer password must be 10–200 characters."), 400);

  let logo = existing?.logo || "";
  const file = form.get("logo");
  if (file && typeof file === "object" && file.size > 0) {
    if (file.size > MAX_LOGO) return html(adminPage("Logo must be a PNG under 300 KB."), 400);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG)) return html(adminPage("Logo must be a PNG file."), 400);
    logo = "data:image/png;base64," + buf.toString("base64");
  }
  if (!logo) return html(adminPage("Add the client logo (PNG) for a new project."), 400);

  const pwHash = pw ? hashPassword(pw) : existing?.pw_hash;
  if (!pwHash && !(process.env["PW_" + code] || "")) return html(adminPage("Set a viewer password for a new project."), 400);

  const now = new Date().toISOString();
  const rec = {
    client_id: token.toLowerCase().replace(/[^a-z0-9]+/g, "-"), client_token: token,
    project_id: code.toLowerCase(), logo, ...(pwHash ? { pw_hash: pwHash } : {}),
    created_at: existing?.created_at || now, updated_at: now, rev: crypto.randomUUID().slice(0, 8),
  };
  await registryStore().setJSON(code, rec);
  await audit(existing ? "admin_update" : "admin_create", { project: code, ip: hexSha(ip).slice(0, 12), password_changed: !!pw, logo_changed: !!(file && file.size) });
  return html(adminResult(code, projectKey(code), !existing, "admin"));
};
export const config = { path: ["/admin", "/api/admin"] };
void esc;
