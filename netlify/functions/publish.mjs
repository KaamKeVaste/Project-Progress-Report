// POST /api/publish  - called by Power Automate after the author clicks Publish in Excel.
import { safeEqual, hexSha, isLocked, addFail, clearFails } from "../lib/auth.mjs";
import { json } from "../lib/util.mjs";
import { snaps, locks, audit } from "../lib/store.mjs";
import { PROJECTS } from "../lib/projects.mjs";
import { buildSnapshot, ValidationError } from "../lib/transform.mjs";

const MAX_BYTES = 60_000;

export default async (req, context) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405, { Allow: "POST" });
  const key = process.env.PUBLISH_KEY || "";
  if (key.length < 24) return json({ ok: false, error: "Server is not configured" }, 500);

  const ip = context?.ip || "unknown";
  const lockKey = "pub-" + hexSha(ip).slice(0, 24);
  if (await isLocked(locks(), lockKey, 10)) return json({ ok: false, error: "Too many attempts. Try later." }, 429);

  const sent = req.headers.get("x-publish-key") || "";
  if (!safeEqual(sent, key)) {
    await addFail(locks(), lockKey);
    await audit("publish_unauthorized", { ip: hexSha(ip).slice(0, 12) });
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  await clearFails(locks(), lockKey);

  const text = await req.text();
  if (text.length > MAX_BYTES) return json({ ok: false, error: "Payload too large" }, 413);
  let raw;
  try {
    raw = JSON.parse(text);
    if (typeof raw === "string") raw = JSON.parse(raw); // tolerate a JSON string wrapped once by the flow
  } catch {
    return json({ ok: false, error: "Body is not valid JSON" }, 400);
  }

  let snap;
  try {
    snap = buildSnapshot(raw, PROJECTS);
  } catch (e) {
    if (e instanceof ValidationError) {
      await audit("publish_rejected", { errors: e.errors.slice(0, 10) });
      return json({ ok: false, errors: e.errors }, 422);
    }
    throw e;
  }

  const code = snap.project.code;
  const store = snaps();
  const current = await store.get(`${code}/current`, { type: "json" });
  const force = req.headers.get("x-force") === "1";
  if (current && snap.week < current.snapshot.week && !force) {
    await audit("publish_rejected", { project: code, errors: ["older week"] });
    return json({ ok: false, errors: [`Week ${snap.week} is older than the published week ${current.snapshot.week}. Nothing was changed.`] }, 409);
  }

  const by = (req.headers.get("x-published-by") || "").replace(/[^\p{L}\p{N} .@_'-]/gu, "").slice(0, 80);
  const rec = { snapshot: snap, published_at: new Date().toISOString(), published_by: by };
  await store.setJSON(`${code}/history/${snap.dates.data_date}-w${snap.week}-${Date.now()}`, rec);
  await store.setJSON(`${code}/current`, rec);
  await audit("publish_ok", { project: code, week: snap.week, data_date: snap.dates.data_date, by });
  return json({ ok: true, project: code, week: snap.week, data_date: snap.dates.data_date,
    planned: snap.overall.planned, actual: snap.overall.actual, spi: snap.overall.spi });
};
export const config = { path: "/api/publish" };
