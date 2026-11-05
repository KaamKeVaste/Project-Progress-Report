// POST /api/publish
// Normal path:  Excel button script -> ONE Power Automate flow (adds x-publish-key) -> here.
// The body is the envelope the Excel script built: { v: 1, projectKey, by, snapshot }.
// Two locks must both open: the flow's master key (x-publish-key) AND the project's own key (inside the envelope),
// so the flow address alone cannot publish, and one project's key cannot publish another project.
import { safeEqual, hexSha, isLocked, addFail, clearFails } from "../lib/auth.mjs";
import { json } from "../lib/util.mjs";
import { snaps, locks, audit } from "../lib/store.mjs";
import { buildSnapshot, titleCode, ValidationError } from "../lib/transform.mjs";
import { getProject, projectKey } from "../lib/registry.mjs";

const MAX_BYTES = 120_000;
const direct = () => process.env.ALLOW_DIRECT === "1";   // optional: Excel may call this site without the flow
const legacy = () => process.env.LEGACY_PUBLISH === "1"; // optional: accept the old 3-script flow during a migration
const cors = () => (direct() ? {
  "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "600" } : {});
const reply = (obj, status) => json(obj, status, cors());

// Reads the request body in every shape the flow or Excel may deliver it.
export function readEnvelope(text) {
  let v = JSON.parse(text);
  if (typeof v === "string") v = JSON.parse(v);                         // JSON wrapped in a string
  if (v && typeof v === "object" && typeof v["$content"] === "string") { // flow passed a non-JSON body through as base64
    v = JSON.parse(Buffer.from(v["$content"], "base64").toString("utf8"));
    if (typeof v === "string") v = JSON.parse(v);
  }
  if (v && typeof v === "object" && v.v === 1 && "snapshot" in v) {
    let snap = v.snapshot;
    if (typeof snap === "string") snap = JSON.parse(snap);
    return { raw: snap, projectKey: typeof v.projectKey === "string" ? v.projectKey : "", by: typeof v.by === "string" ? v.by : "" };
  }
  return { raw: v, projectKey: "", by: "" }; // bare snapshot (old scripts)
}

export default async (req, context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: direct() ? 204 : 405, headers: cors() });
  if (req.method !== "POST") return reply({ ok: false, error: "POST only" }, 405);
  const master = process.env.PUBLISH_KEY || "";
  if (master.length < 24) return reply({ ok: false, error: "Website is not configured (PUBLISH_KEY)" }, 500);

  const ip = context?.ip || "unknown";
  const ipLock = "pub-" + hexSha(ip).slice(0, 24);
  const L = locks();
  if (await isLocked(L, ipLock, 10)) return reply({ ok: false, error: "Too many failed attempts. Try again in 15 minutes." }, 429);

  const sentMaster = req.headers.get("x-publish-key") || "";
  const viaFlow = sentMaster !== "" && safeEqual(sentMaster, master);
  if (!viaFlow && (sentMaster !== "" || !direct())) {
    await addFail(L, ipLock);
    await audit("publish_unauthorized", { ip: hexSha(ip).slice(0, 12) });
    return reply({ ok: false, error: "Unauthorized: the flow's publish key is wrong" }, 401);
  }

  const text = await req.text();
  if (text.length > MAX_BYTES) return reply({ ok: false, error: "Data too large" }, 413);
  let env;
  try { env = readEnvelope(text); } catch { return reply({ ok: false, error: "Body is not valid JSON" }, 400); }

  const code = titleCode(env.raw?.title);
  if (!code) return reply({ ok: false, errors: ["Project title in Dashboard!B3 is not in the expected format"] }, 422);
  const project = await getProject(code);
  if (!project) return reply({ ok: false, errors: [`Project '${code}' is not registered on this website. Add it on the admin page first.`] }, 422);

  const keyLock = "pkey-" + hexSha(ip + "|" + code).slice(0, 24);
  if (await isLocked(L, keyLock, 10)) return reply({ ok: false, error: "Too many wrong project keys. Try again in 15 minutes." }, 429);
  const skipProjectKey = legacy() && viaFlow && env.projectKey === "";
  if (!skipProjectKey && !safeEqual(env.projectKey, projectKey(code) || "")) {
    await addFail(L, keyLock);
    await audit("publish_bad_project_key", { project: code, ip: hexSha(ip).slice(0, 12) });
    return reply({ ok: false, errors: [`The project key in the _config sheet does not belong to project ${code}.`] }, 401);
  }
  await clearFails(L, ipLock); await clearFails(L, keyLock);

  let snap;
  try {
    snap = buildSnapshot(env.raw, { [code]: project });
  } catch (e) {
    if (e instanceof ValidationError) {
      await audit("publish_rejected", { project: code, errors: e.errors.slice(0, 10) });
      return reply({ ok: false, errors: e.errors }, 422);
    }
    throw e;
  }

  const store = snaps();
  const current = await store.get(`${code}/current`, { type: "json" });
  const force = req.headers.get("x-force") === "1";
  if (current && snap.week < current.snapshot.week && !force) {
    await audit("publish_rejected", { project: code, errors: ["older week"] });
    return reply({ ok: false, errors: [`Week ${snap.week} is older than the published week ${current.snapshot.week}. Nothing was changed.`] }, 409);
  }

  const by = String(env.by || req.headers.get("x-published-by") || "").replace(/[^\p{L}\p{N} .@_'-]/gu, "").slice(0, 80);
  const rec = { snapshot: snap, published_at: new Date().toISOString(), published_by: by };
  await store.setJSON(`${code}/history/${snap.dates.data_date}-w${snap.week}-${Date.now()}`, rec);
  await store.setJSON(`${code}/current`, rec);
  await audit("publish_ok", { project: code, week: snap.week, data_date: snap.dates.data_date, by, via: viaFlow ? "flow" : "direct" });
  return reply({ ok: true, project: code, week: snap.week, data_date: snap.dates.data_date,
    planned: snap.overall.planned, actual: snap.overall.actual, spi: snap.overall.spi }, 200);
};
export const config = { path: "/api/publish" };
