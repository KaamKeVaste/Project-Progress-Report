import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

process.env.PUBLISH_KEY = "k".repeat(40);
process.env.SESSION_SECRET = "s".repeat(48);
process.env.PW_ORB2 = "Orion-Pass-2026";
process.env.PW_HLX3 = "Helix-Pass-2026";

const { setStoreFactory } = await import("../netlify/lib/store.mjs");
const { PROJECTS } = await import("../netlify/lib/projects.mjs");
const { sign } = await import("../netlify/lib/auth.mjs");
const publish = (await import("../netlify/functions/publish.mjs")).default;
const login = (await import("../netlify/functions/login.mjs")).default;
const view = (await import("../netlify/functions/view.mjs")).default;
const status = (await import("../netlify/functions/status.mjs")).default;
const health = (await import("../netlify/functions/health.mjs")).default;
const logout = (await import("../netlify/functions/logout.mjs")).default;

const G = (f) => fs.readFileSync(new URL("./gold/" + f, import.meta.url), "utf8");
PROJECTS.HLX3 = { client_id: "helix", client_token: "HELIX", project_id: "hlx3-pilot-plant", logo: G("HLX3.logo.txt") };

// in-memory stand-in for Netlify Blobs
const mem = {};
setStoreFactory((name) => {
  const m = (mem[name] ??= new Map());
  return {
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
  };
});

const U = "https://site.test";
const KEY = process.env.PUBLISH_KEY;
const ctx = (ip = "1.2.3.4") => ({ ip });
const post = (path, body, headers = {}) => new Request(U + path, { method: "POST", body, headers });
const pub = (raw, headers = {}, ip) => publish(post("/api/publish", typeof raw === "string" ? raw : JSON.stringify(raw), { "x-publish-key": KEY, ...headers }), ctx(ip));
const form = (o) => new URLSearchParams(o).toString();
const doLogin = (project, password, ip = "9.9.9.9") =>
  login(post("/api/login", form({ project, password }), { "content-type": "application/x-www-form-urlencoded" }), ctx(ip));
const cookieOf = (res) => (res.headers.get("set-cookie") || "").split(";")[0];
const get = (path, cookie) => view(new Request(U + path, { headers: cookie ? { cookie } : {} }));
const raw = (c) => JSON.parse(G(`${c}.raw.json`));

test("publish: wrong, missing or short key is refused and nothing is stored", async () => {
  assert.equal((await publish(post("/api/publish", "{}", { "x-publish-key": "nope" }), ctx("5.5.5.5"))).status, 401);
  assert.equal((await publish(post("/api/publish", "{}"), ctx("5.5.5.5"))).status, 401);
  assert.equal((await publish(new Request(U + "/api/publish"), ctx())).status, 405);
  assert.equal(mem.snapshots?.size ?? 0, 0);
});
test("publish: key brute force gets locked (429)", async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await publish(post("/api/publish", "{}", { "x-publish-key": "bad" + i }), ctx("6.6.6.6"));
  assert.equal(last.status, 429);
  // a locked address cannot publish even with the right key
  assert.equal((await pub(raw("ORB2"), {}, "6.6.6.6")).status, 429);
});
test("publish: bad body, too large, invalid data", async () => {
  assert.equal((await pub("{not json")).status, 400);
  assert.equal((await pub("x".repeat(70000))).status, 413);
  const bad = raw("ORB2"); bad.phases[0].actual = 1.5;
  const r = await pub(bad); assert.equal(r.status, 422);
  assert.match(JSON.stringify(await r.json()), /between 0 and 100/);
  assert.equal(mem.snapshots?.has("ORB2/current") ?? false, false);
});
test("publish: good ORB2 data is accepted, stored and reported", async () => {
  const r = await pub(raw("ORB2"), { "x-published-by": "Samarth B S" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.ok, j.project, j.week, j.actual, j.planned, j.spi], [true, "ORB2", 24, 31.6, 35.9, 0.88]);
  const st = await status(new Request(U + "/api/status?project=ORB2", { headers: { "x-publish-key": KEY } }));
  const sj = await st.json();
  assert.equal(sj.published, true); assert.equal(sj.published_by, "Samarth B S");
  assert.equal((await status(new Request(U + "/api/status?project=ORB2"))).status, 401);
});
test("publish: flow may send the JSON wrapped once as a string", async () => {
  const r = await pub(JSON.stringify(JSON.stringify(raw("ORB2"))));
  assert.equal(r.status, 200);
});
test("publish: an OLDER week is refused (409) unless forced", async () => {
  // pretend week 25 is already published, then try to publish week 24 again
  const cur = JSON.parse(mem.snapshots.get("ORB2/current"));
  cur.snapshot.week = 25;
  mem.snapshots.set("ORB2/current", JSON.stringify(cur));
  const r1 = await pub(raw("ORB2"));
  assert.equal(r1.status, 409);
  assert.match(JSON.stringify(await r1.json()), /older than the published week 25/);
  assert.equal(JSON.parse(mem.snapshots.get("ORB2/current")).snapshot.week, 25);   // untouched
  const r2 = await pub(raw("ORB2"), { "x-force": "1" });
  assert.equal(r2.status, 200);
  assert.equal(JSON.parse(mem.snapshots.get("ORB2/current")).snapshot.week, 24);
});
test("publish: HELIX file cannot be published as ORION (client mismatch)", async () => {
  const r = await pub(raw("HLX3"));         // registered for HELIX -> fine
  assert.equal(r.status, 200);
  const crossed = raw("HLX3"); crossed.title = crossed.title.replace("HELIX", "ORION");
  assert.equal((await pub(crossed)).status, 422);
  const wrongCode = raw("ORB2"); wrongCode.title = wrongCode.title.replace("ORB2", "HLX3");
  assert.equal((await pub(wrongCode)).status, 422);
});
test("view: no cookie shows only the password page - no data", async () => {
  const res = await get("/p/ORB2");
  const t = await res.text();
  assert.equal(res.status, 200);
  assert.match(t, /Enter the password/);
  assert.ok(!t.includes("31.6") && !t.includes("Orion") && !t.includes("AGV1"));
  assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
  assert.match(res.headers.get("x-robots-tag"), /noindex/);
});
test("view: unknown project looks the same as a real one", async () => {
  const a = await (await get("/p/ZZZ9")).text();
  assert.match(a, /Enter the password/);
  assert.equal((await get("/p/bad%20code!")).status, 404);
  assert.equal((await get("/p/")).status, 404);
});
test("login: wrong password refused; right password opens only that project", async () => {
  const bad = await doLogin("ORB2", "wrong-password");
  assert.equal(bad.status, 401); assert.ok(!bad.headers.get("set-cookie"));
  assert.match(await bad.text(), /Incorrect password/);

  const ok = await doLogin("ORB2", "Orion-Pass-2026", "7.7.7.7");
  assert.equal(ok.status, 303);
  const sc = ok.headers.get("set-cookie");
  assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Max-Age=1800/);
  const ck = cookieOf(ok);

  const page = await get("/p/ORB2", ck);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.ok(html.includes("31.6") && html.includes("Orion"));
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(page.headers.get("cache-control"), "no-store, max-age=0");

  // the Orion password does NOT open the Helix project, and the Orion cookie is useless there
  const other = await (await get("/p/HLX3", ck)).text();
  assert.match(other, /Enter the password/); assert.ok(!other.includes("Helix"));
  const cross = await doLogin("HLX3", "Orion-Pass-2026", "8.8.8.8");
  assert.equal(cross.status, 401);
});
test("login: Helix password opens Helix only", async () => {
  const ok = await doLogin("HLX3", "Helix-Pass-2026", "7.7.7.8");
  assert.equal(ok.status, 303);
  const html = await (await get("/p/HLX3", cookieOf(ok))).text();
  assert.ok(html.includes("Helix"));
  assert.match(await (await get("/p/ORB2", cookieOf(ok))).text(), /Enter the password/);
});
test("cookie: forged, tampered, expired and missing-secret cookies are rejected", async () => {
  const good = cookieOf(await doLogin("ORB2", "Orion-Pass-2026", "7.7.7.9"));
  const tok = good.split("=")[1];
  const tampered = "kwsess=" + tok.slice(0, -3) + (tok.endsWith("AAA") ? "BBB" : "AAA");
  assert.match(await (await get("/p/ORB2", tampered)).text(), /Enter the password/);
  const forged = "kwsess=" + sign({ p: "ORB2", exp: Math.floor(Date.now() / 1000) + 999 }, "x".repeat(48));
  assert.match(await (await get("/p/ORB2", forged)).text(), /Enter the password/);
  const expired = "kwsess=" + sign({ p: "ORB2", exp: Math.floor(Date.now() / 1000) - 5 }, process.env.SESSION_SECRET);
  assert.match(await (await get("/p/ORB2", expired)).text(), /Enter the password/);
  const noneAlg = "kwsess=" + Buffer.from(JSON.stringify({ p: "ORB2", exp: 9999999999 })).toString("base64url") + ".";
  assert.match(await (await get("/p/ORB2", noneAlg)).text(), /Enter the password/);
});
test("login: 5 wrong passwords lock the address for 15 minutes - even the right password is refused", async () => {
  let last;
  for (let i = 0; i < 5; i++) last = await doLogin("ORB2", "guess" + i, "4.4.4.4");
  const locked = await doLogin("ORB2", "Orion-Pass-2026", "4.4.4.4");
  assert.equal(locked.status, 429);
  assert.match(await locked.text(), /Too many wrong attempts/);
  // another address is not affected
  assert.equal((await doLogin("ORB2", "Orion-Pass-2026", "4.4.4.5")).status, 303);
});
test("login: project missing from env, short or empty passwords never work (fail closed)", async () => {
  delete process.env.PW_ORB2;
  assert.equal((await doLogin("ORB2", "", "3.3.3.3")).status, 401);
  assert.equal((await doLogin("ORB2", "undefined", "3.3.3.3")).status, 401);
  process.env.PW_ORB2 = "short";
  assert.equal((await doLogin("ORB2", "short", "3.3.3.4")).status, 401);
  process.env.PW_ORB2 = "Orion-Pass-2026";
});
test("login: when SESSION_SECRET is missing the site refuses to sign anyone in", async () => {
  const keep = process.env.SESSION_SECRET; process.env.SESSION_SECRET = "short";
  assert.equal((await doLogin("ORB2", "Orion-Pass-2026", "2.2.2.2")).status, 500);
  process.env.SESSION_SECRET = keep;
});
test("logout clears the cookie; health needs the key and never shows secrets", async () => {
  const r = await logout(new Request(U + "/api/logout"));
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await health(new Request(U + "/api/health"))).status, 401);
  const h = await health(new Request(U + "/api/health", { headers: { "x-publish-key": KEY } }));
  const txt = await h.text();
  assert.ok(!txt.includes(KEY) && !txt.includes("Orion-Pass-2026"));
  const j = JSON.parse(txt);
  assert.equal(j.storage_ok, true); assert.equal(j.session_secret_ok, true);
  assert.deepEqual(j.projects, [{ project: "ORB2", password_set: true }, { project: "HLX3", password_set: true }]);
});
test("audit trail records publishes and logins, and no passwords", async () => {
  const all = [...mem.audit.values()].join("\n");
  assert.match(all, /publish_ok/); assert.match(all, /login_fail/); assert.match(all, /login_ok/); assert.match(all, /publish_unauthorized/);
  assert.ok(!all.includes("Orion-Pass-2026") && !all.includes("wrong-password") && !all.includes(KEY));
});
test("stored snapshot contains only allow-listed data", async () => {
  const rec = JSON.parse(mem.snapshots.get("ORB2/current"));
  assert.deepEqual(Object.keys(rec.snapshot).sort(), ["D", "client", "dates", "days_left", "overall", "project", "template_version", "total_weeks", "week"]);
  assert.deepEqual(Object.keys(rec.snapshot.D).sort(), ["ms", "ph", "sc"]);
  assert.equal(rec.snapshot.D.ms.length, 12); assert.equal(rec.snapshot.D.ph.length, 7); assert.equal(rec.snapshot.D.sc.length, 60);
});
