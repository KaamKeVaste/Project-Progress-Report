// GET /api/status?project=ORB2  (needs the publish key) - what is currently published.
import { safeEqual, projectCode } from "../lib/auth.mjs";
import { json } from "../lib/util.mjs";
import { snaps } from "../lib/store.mjs";

export default async (req) => {
  const key = process.env.PUBLISH_KEY || "";
  if (key.length < 24 || !safeEqual(req.headers.get("x-publish-key") || "", key)) return json({ ok: false, error: "Unauthorized" }, 401);
  const code = projectCode(new URL(req.url).searchParams.get("project"));
  if (!code) return json({ ok: false, error: "project is required" }, 400);
  const rec = await snaps().get(`${code}/current`, { type: "json" });
  if (!rec) return json({ ok: true, published: false });
  const s = rec.snapshot;
  return json({ ok: true, published: true, week: s.week, data_date: s.dates.data_date, actual: s.overall.actual,
    planned: s.overall.planned, spi: s.overall.spi, published_at: rec.published_at, published_by: rec.published_by });
};
export const config = { path: "/api/status" };
