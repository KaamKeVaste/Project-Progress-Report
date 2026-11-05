// GET /api/health  (needs the publish key) - setup check. Never shows secret values.
import { safeEqual } from "../lib/auth.mjs";
import { json } from "../lib/util.mjs";
import { locks } from "../lib/store.mjs";
import { PROJECTS } from "../lib/projects.mjs";

export default async (req) => {
  const key = process.env.PUBLISH_KEY || "";
  if (key.length < 24 || !safeEqual(req.headers.get("x-publish-key") || "", key)) return json({ ok: false, error: "Unauthorized" }, 401);
  let storage = false;
  try { const s = locks(); await s.setJSON("health", { t: Date.now() }); storage = !!(await s.get("health", { type: "json" })); } catch { storage = false; }
  const projects = Object.keys(PROJECTS).map((c) => ({ project: c, password_set: (process.env["PW_" + c] || "").length >= 8 }));
  return json({ ok: true, storage_ok: storage, session_secret_ok: (process.env.SESSION_SECRET || "").length >= 32,
    publish_key_ok: true, projects });
};
export const config = { path: "/api/health" };
