import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pyRound, pyJson } from "../netlify/lib/util.mjs";
import { buildSnapshot, ValidationError } from "../netlify/lib/transform.mjs";
import { renderDashboard } from "../netlify/lib/render.mjs";
import { PROJECTS } from "../netlify/lib/projects.mjs";

const G = (f) => fs.readFileSync(new URL("./gold/" + f, import.meta.url), "utf8");
const REG = { ...PROJECTS, HLX3: { client_id: "helix", client_token: "HELIX", project_id: "hlx3-pilot-plant", logo: G("HLX3.logo.txt") } };

test("pyRound matches Python round() on 30,000 values incl. exact ties", () => {
  const rows = JSON.parse(G("round.json"));
  let bad = 0;
  for (const [x, nd, want] of rows) if (pyRound(x, nd) !== want) bad++;
  assert.equal(bad, 0);
});

const base = () => JSON.parse(G("ORB2.raw.json"));
const html = (raw) => renderDashboard(buildSnapshot(raw, REG), REG[raw.title.includes("HELIX") ? "HLX3" : "ORB2"].logo);

for (const code of ["ORB2", "HLX3"]) {
  test(`${code}: every number on the page comes from the workbook payload`, () => {
    const raw = JSON.parse(G(`${code}.raw.json`));
    const snap = buildSnapshot(raw, REG);
    assert.equal(snap.week, raw.week);
    assert.equal(snap.total_weeks, raw.curve.length);
    assert.equal(snap.overall.actual, pyRound(raw.actual * 100, 1));
    assert.equal(snap.overall.planned, pyRound(raw.planned * 100, 1));
    assert.equal(snap.D.ph.length, raw.phases.length);
    assert.equal(snap.D.ms.length, raw.milestones.length);
    const out = html(raw);
    assert.ok(!out.includes("__K_"));
    assert.ok(out.includes(`Week ${raw.week} of ${raw.curve.length}`));
  });
}
test("names are shown exactly as typed in Excel (no fixed renames)", () => {
  const raw = base();
  raw.phases[0].name = "Order Processing – Revised Name";
  raw.milestones[0].name = "◆ My Brand New Milestone (Client Team)";
  const snap = buildSnapshot(raw, REG);
  assert.ok(snap.D.ph.some((p) => p[0] === "Order Processing – Revised Name"));
  assert.ok(snap.D.ms.some((m) => m[1] === "My Brand New Milestone (Client Team)"));
});
test("milestone ring uses the milestone's own Actual % (e.g. 50%)", () => {
  const raw = base();
  const m = raw.milestones.find((x) => x.wbs === "1.1.2");
  m.actual = 0.5; m.status = "Upcoming";
  const row = buildSnapshot(raw, REG).D.ms.find((x) => x[1].startsWith("Detail Engineering"));
  assert.deepEqual([row[2], row[3]], [0, 50]);
  m.actual = 1;
  const row2 = buildSnapshot(raw, REG).D.ms.find((x) => x[1].startsWith("Detail Engineering"));
  assert.deepEqual([row2[2], row2[3]], [1, 100]);
  m.actual = 0.2; m.actFinish = "2026-10-20";
  const row3 = buildSnapshot(raw, REG).D.ms.find((x) => x[1].startsWith("Detail Engineering"));
  assert.deepEqual([row3[2], row3[3]], [1, 100]);
});
test("adding or removing a milestone / phase in Excel changes the page", () => {
  const raw = base();
  raw.milestones.push({ wbs: "1.1.13", name: "◆ Extra Milestone", due: "2027-03-15", actual: 0, actFinish: null, status: "Upcoming" });
  raw.phases.pop();
  const snap = buildSnapshot(raw, REG);
  assert.equal(snap.D.ms.length, 13);
  assert.equal(snap.D.ph.length, raw.phases.length);
  assert.ok(html(raw).includes("Extra Milestone"));
});
test("project length comes from the S-curve rows (not fixed at 60 weeks)", () => {
  const raw = base();
  raw.curve = raw.curve.slice(0, 52);
  raw.curve[51][2] = 1;
  const snap = buildSnapshot(raw, REG);
  assert.equal(snap.total_weeks, 52);
  const out = html(raw);
  assert.ok(out.includes("Week 24 of 52"));
  assert.ok(out.includes('data-r="52"'));
  // a longer project also works
  const r2 = base();
  for (let i = 60; i < 80; i++) r2.curve.push([i + 1, "2027-07-0" + 1, 1, null]);
  assert.equal(buildSnapshot(r2, REG).total_weeks, 80);
});
test("weekly chart axis grows with the data instead of a fixed 4%", () => {
  const raw = base();
  for (let i = 0; i < raw.curve.length; i++) raw.curve[i][2] = Math.min(1, (i + 1) / 10);
  raw.curve.forEach((r) => { if (r[3] != null) r[3] = null; });
  raw.planned = raw.curve[raw.week - 1][2]; raw.actual = 0; raw.spi = 0;
  raw.phases.forEach((p) => { p.actual = 0; });
  raw.milestones.forEach((m) => { m.actual = 0; m.status = "Upcoming"; m.actFinish = null; });
  for (let i = 0; i < raw.week; i++) raw.curve[i][3] = 0;
  const out = html(raw);
  assert.ok(/BMX=12[,;]/.test(out) || /BMX=1[0-9][,;]/.test(out), "axis max should be ≥10% when weeks earn 10%");
});

const rejects = (mutate, re) => {
  const raw = base(); mutate(raw);
  assert.throws(() => buildSnapshot(raw, REG), (e) => e instanceof ValidationError && re.test(e.message), re.toString());
};
test("blocking rules", () => {
  rejects((r) => { r.phases[0].actual = 1.5; }, /between 0 and 100/);
  rejects((r) => { r.title = "PROJECT : HELIX - ORB2-R&D LAB - PHASE I"; }, /belongs to client 'HELIX'/);
  rejects((r) => { r.title = "PROJECT : ORION - ZZZ9-R&D LAB - PHASE I"; }, /not registered/);
  rejects((r) => { r.title = "hello"; }, /expected format/);
  rejects((r) => { r.week = 61; }, /Report week/);
  rejects((r) => { r.spi = 0.5; }, /SPI does not equal/);
  rejects((r) => { r.daysLeft = 1; }, /Days to finish/);
  rejects((r) => { r.curve = r.curve.slice(0, 1); }, /between 2 and 260 weeks/);
  rejects((r) => { r.curve[59][2] = 0.995; }, /reach 100/);
  rejects((r) => { r.curve[10][2] = 0.0; }, /must rise/);
  rejects((r) => { r.dataDate = "2028-01-01"; }, /outside the project dates/);
  rejects((r) => { r.start = r.finish; }, /start must be before/);
  rejects((r) => { r.phases[1].status = "Weird"; }, /unknown status/);
  rejects((r) => { r.milestones[0].name = "Release of PO"; }, /must start with/);
  rejects((r) => { r.milestones[2].due = null; }, /due date missing/);
  rejects((r) => { r.curve[23][3] = 0.9; }, /does not match the overall actual/);
});
test("anything extra or unsafe is refused (no remarks, RAID, names, markup)", () => {
  rejects((r) => { r.raid = [{ owner: "someone" }]; }, /Unexpected field 'raid'/);
  rejects((r) => { r.phases[0].remarks = "secret"; }, /unexpected fields/);
  rejects((r) => { r.milestones[0].owner = "A. Person"; }, /unexpected fields/);
  rejects((r) => { r.phases[0].name = "<img src=x onerror=alert(1)>"; }, /invalid characters/);
  rejects((r) => { r.milestones[0].name = "◆ <script>alert(1)</script>"; }, /must start with/);
  rejects((r) => { r.phases = null; }, /phases must be a list/);
  rejects((r) => { r.curve = "x"; }, /between 2 and 260 weeks/);
  assert.throws(() => buildSnapshot("nope", REG), ValidationError);
  assert.throws(() => buildSnapshot(null, REG), ValidationError);
});
test("quotes and ampersands in names are kept but cannot break the page", () => {
  const raw = base();
  raw.milestones[1].name = '◆ Fit-out "phase" A&B';
  const snap = buildSnapshot(raw, REG);
  const html = renderDashboard(snap, REG.ORB2.logo);
  assert.ok(!html.includes('"phase" A&B'));
  assert.ok(html.includes("Fit-out"));
});
test("pyJson is ASCII-only and cannot close a script tag", () => {
  const s = pyJson({ a: "</script>é中", b: [1, 2.5, null] });
  assert.ok(!/[^\x00-\x7f]/.test(s));
  assert.ok(s.includes("\\u00e9"));
});
