// GET /api/health  (needs the publish key) - setup check. Never shows secret values.
import { safeEqual } from "../lib/auth.mjs";
import { json } from "../lib/util.mjs";
import { locks } from "../lib/store.mjs";
import { listProjects, getProject, passwordSet } from "../lib/registry.mjs";

export default async (req) => {
  const key = process.env.PUBLISH_KEY || "";
  if (key.length < 24 || !safeEqual(req.headers.get("x-publish-key") || "", key)) return json({ ok: false, error: "Unauthorized" }, 401);
  let storage = false;
  try { const s = locks(); await s.setJSON("health", { t: Date.now() }); storage = !!(await s.get("health", { type: "json" })); } catch { storage = false; }
  const projects = [];
  for (const p of await listProjects()) projects.push({ project: p.code, source: p.source, password_set: passwordSet(await getProject(p.code), p.code) });
  return json({ ok: true, storage_ok: storage, session_secret_ok: (process.env.SESSION_SECRET || "").length >= 32,
    publish_key_ok: true, admin_ok: (process.env.ADMIN_KEY || "").length >= 24,
    direct_publish: process.env.ALLOW_DIRECT === "1", projects });
};
export const config = { path: "/api/health" };
