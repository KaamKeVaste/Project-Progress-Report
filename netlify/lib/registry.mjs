// Project registry: projects added on the /admin page (stored in Netlify Blobs) plus any listed in projects.mjs.
// Adding a project never needs a code change or a redeploy.
import crypto from "node:crypto";
import { PROJECTS } from "./projects.mjs";
import { registryStore } from "./store.mjs";
import { safeEqual } from "./auth.mjs";

export const CODE_RE = /^[A-Z0-9]{2,12}$/;
export const TOKEN_RE = /^[A-Z0-9&]+(?: [A-Z0-9&]+)*$/;

export async function getProject(code) {
  if (!CODE_RE.test(String(code))) return null;
  let rec = null;
  try { rec = await registryStore().get(code, { type: "json" }); } catch { rec = null; }
  if (rec) return { ...rec, source: "admin" };
  return PROJECTS[code] ? { ...PROJECTS[code], source: "code" } : null;
}

export async function listProjects() {
  const out = Object.keys(PROJECTS).map((c) => ({ code: c, source: "code" }));
  try {
    const res = await registryStore().list();
    for (const b of res?.blobs ?? []) if (CODE_RE.test(b.key) && !out.some((o) => o.code === b.key)) out.push({ code: b.key, source: "admin" });
  } catch { /* listing is informational only */ }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

// Each project's publish key is derived from the master PUBLISH_KEY, so nothing extra has to be stored.
// A key only works for its own project. Changing PUBLISH_KEY changes every project key.
export function projectKey(code) {
  const master = process.env.PUBLISH_KEY || "";
  if (master.length < 24 || !CODE_RE.test(String(code))) return null;
  return "pk_" + crypto.createHmac("sha256", master).update("kewaunee-project-key:" + code).digest("base64url").slice(0, 32);
}

const ITER = 210000;
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.pbkdf2Sync(String(pw), salt, ITER, 32, "sha256");
  return `pbkdf2$${ITER}$${salt.toString("base64url")}$${h.toString("base64url")}`;
}
export function checkPassword(project, code, pw) {
  if (project?.pw_hash) {
    const [alg, it, salt, hash] = String(project.pw_hash).split("$");
    if (alg !== "pbkdf2" || !(+it > 0) || !salt || !hash) return false;
    const got = crypto.pbkdf2Sync(String(pw), Buffer.from(salt, "base64url"), +it, 32, "sha256");
    const want = Buffer.from(hash, "base64url");
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
  const env = process.env["PW_" + code] || "";
  return env.length >= 8 && safeEqual(String(pw), env);
}
export function passwordSet(project, code) {
  return !!project?.pw_hash || (process.env["PW_" + code] || "").length >= 8;
}
