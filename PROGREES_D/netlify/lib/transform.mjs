// Validates the raw data sent by the Excel "Publish" script and turns it into a clean snapshot.
// Everything shown on the dashboard comes from the workbook; there are no fixed names, mappings or week counts.
// Anything wrong => nothing is published.
import { pyRound, parseISO, isoOf, fmtDate, DAY } from "./util.mjs";

export class ValidationError extends Error {
  constructor(errors) { super(errors.join("; ")); this.errors = errors; }
}

const MIN_WEEKS = 2, MAX_WEEKS = 260;
const ACRONYMS = ["NMR", "IT", "PO", "HVAC", "BMS", "UPS", "MEP", "R&D", "CO2", "FAT", "SAT", "IQ", "OQ", "PQ"]; // title-case formatting only
const PHASE_STATUS = {
  "Completed": "done",
  "In Progress – Behind": "behind",
  "In Progress – Ahead": "progress",
  "In Progress": "progress",
  "Not Started": "notstarted",
};
const TOP = ["title", "dataDate", "week", "start", "finish", "daysLeft", "planned", "actual", "spi", "phases", "milestones", "curve"];
const PH_KEYS = ["wbs", "name", "planned", "actual", "finish", "actFinish", "status"];
const MS_KEYS = ["wbs", "name", "due", "actual", "actFinish", "status"];
const TITLE_RE = /^PROJECT\s*:\s*([A-Z0-9&]+(?: [A-Z0-9&]+)*)\s+-\s+([A-Z0-9]+)-(.+?)\s+-\s+PHASE\s+([IVX0-9]+)\s*$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w);
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001f\u007f<>]/;
function okText(v, max) { return typeof v === "string" && v.length > 0 && v.length <= max && !BAD_CHARS.test(v); }

// Shows the name exactly as typed in the workbook (only the ◆ marker and extra spaces are removed).
// Project code written in the workbook title (Dashboard!B3), or null.
export function titleCode(title) {
  const m = typeof title === "string" && title.length <= 120 ? TITLE_RE.exec(title) : null;
  return m ? m[2] : null;
}

export function cleanName(raw) {
  return String(raw).replace(/◆/g, "").replace(/\s+/g, " ").trim();
}

export function buildSnapshot(raw, registry) {
  const errors = [];
  if (!isObj(raw)) throw new ValidationError(["Payload must be a JSON object"]);
  for (const k of Object.keys(raw)) if (!TOP.includes(k)) errors.push(`Unexpected field '${k}'`);
  if (!Array.isArray(raw.phases) || raw.phases.length > 30) errors.push("phases must be a list of at most 30 rows");
  if (!Array.isArray(raw.milestones) || raw.milestones.length > 40) errors.push("milestones must be a list of at most 40 rows");
  if (!Array.isArray(raw.curve) || raw.curve.length < MIN_WEEKS || raw.curve.length > MAX_WEEKS) errors.push(`S-curve must list between ${MIN_WEEKS} and ${MAX_WEEKS} weeks`);
  if (errors.length) throw new ValidationError(errors);
  const TOTAL_WEEKS = raw.curve.length;
  for (const p of raw.phases) {
    if (!isObj(p) || Object.keys(p).some((k) => !PH_KEYS.includes(k))) throw new ValidationError(["A phase row has unexpected fields"]);
  }
  for (const m of raw.milestones) {
    if (!isObj(m) || Object.keys(m).some((k) => !MS_KEYS.includes(k))) throw new ValidationError(["A milestone row has unexpected fields"]);
  }

  // ---- identity: client and project come from the workbook title, checked against the registry
  if (typeof raw.title !== "string" || raw.title.length > 120) throw new ValidationError(["Project title is missing or too long"]);
  const m = TITLE_RE.exec(raw.title);
  if (!m) throw new ValidationError(["Project title in Dashboard!B3 is not in the expected format"]);
  const [, clientToken, code, facilityRaw, phaseNo] = m;
  const facility = facilityRaw.trim();
  const project = registry[code];
  if (!project) throw new ValidationError([`Project '${code}' is not registered on this website. Nothing was published.`]);
  if (clientToken !== project.client_token) {
    throw new ValidationError([`Workbook belongs to client '${clientToken}', but project ${code} is registered for '${project.client_token}'. Nothing was published.`]);
  }
  const acr = ACRONYMS;
  const facShort = facility.split(/\s+/).filter(Boolean).map((w) => (acr.includes(w) ? w : cap(w))).join(" ");
  const facLong = facShort.replace(/\bLab\b/g, "Laboratory");

  // ---- headline numbers
  const dataDate = parseISO(raw.dataDate), start = parseISO(raw.start), finish = parseISO(raw.finish);
  const week = raw.week, daysLeft = raw.daysLeft;
  const planned = raw.planned, actual = raw.actual, spi = raw.spi;
  if (dataDate === null) errors.push("Data date (Dashboard!D7) is missing or not a date");
  if (start === null || finish === null) errors.push("Project start/finish dates are missing");
  if (start !== null && finish !== null && !(start < finish)) errors.push("Project start must be before project finish");
  if (dataDate !== null && start !== null && finish !== null && !(start <= dataDate && dataDate <= finish)) errors.push("Data date is outside the project dates");
  if (!Number.isInteger(week) || week < 1 || week > TOTAL_WEEKS) errors.push(`Report week must be a whole number between 1 and ${TOTAL_WEEKS}`);
  for (const [label, v] of [["Overall planned", planned], ["Overall actual", actual]]) {
    if (!isNum(v) || v < 0 || v > 1.0000001) errors.push(`${label} % must be between 0 and 100`);
  }
  if (!isNum(spi)) errors.push("SPI is missing");
  else if (isNum(planned) && planned && isNum(actual) && Math.abs(spi - actual / planned) > 1e-6) errors.push("SPI does not equal actual ÷ planned");
  if (dataDate !== null && finish !== null && daysLeft !== Math.round((finish - dataDate) / DAY)) errors.push("Days to finish does not match the dates");

  // ---- phases (1.x) and key milestones (1.1.x)
  const phases = [], milestones = [], phaseActual = {}, badPhases = new Set();
  for (const p of raw.phases) {
    const wbs = p.wbs;
    if (typeof wbs !== "string" || !/^1\.\d+$/.test(wbs) || wbs === "1.1") { errors.push("Unexpected phase code"); continue; }
    const fin = parseISO(p.finish), act = p.actFinish === null ? null : parseISO(p.actFinish);
    if (!isNum(p.planned) || !isNum(p.actual) || p.planned < 0 || p.planned > 1.0000001 || p.actual < 0 || p.actual > 1.0000001) {
      errors.push(`Phase ${wbs}: planned/actual % must be between 0 and 100`); badPhases.add(wbs);
    } else if (!Object.hasOwn(PHASE_STATUS, p.status)) {
      errors.push(`Phase ${wbs}: unknown status '${String(p.status).slice(0, 30)}'`); badPhases.add(wbs);
    } else if (fin === null) {
      errors.push(`Phase ${wbs}: schedule finish date missing`); badPhases.add(wbs);
    } else if (!okText(p.name, 120)) {
      errors.push(`Phase ${wbs}: name is missing or has invalid characters`); badPhases.add(wbs);
    } else {
      const done = PHASE_STATUS[p.status] === "done";
      const f = done && act !== null ? act : fin;
      const disp = cleanName(p.name);
      phases.push([disp, pyRound(p.planned * 100, 1), pyRound(p.actual * 100, 1), fmtDate(f), PHASE_STATUS[p.status]]);
      phaseActual[wbs] = p.actual;
    }
  }
  for (const r of raw.milestones) {
    const wbs = r.wbs;
    if (typeof wbs !== "string" || !/^1\.1\.\d+$/.test(wbs)) { errors.push("Unexpected milestone code"); continue; }
    const due = parseISO(r.due);
    if (!okText(r.name, 120) || !r.name.trim().startsWith("◆")) errors.push(`Milestone ${wbs}: name must start with ◆`);
    else if (due === null) errors.push(`Milestone ${wbs}: due date missing`);
    else if (!isNum(r.actual) || r.actual < 0 || r.actual > 1.0000001) errors.push(`Milestone ${wbs}: actual % must be between 0 and 100`);
    else if (!["Achieved", "Upcoming", "Overdue"].includes(r.status)) errors.push(`Milestone ${wbs}: unknown status '${String(r.status).slice(0, 30)}'`);
    else if (r.actFinish !== undefined && r.actFinish !== null && parseISO(r.actFinish) === null) errors.push(`Milestone ${wbs}: actual finish is not a date`);
    else milestones.push({ wbs, due, raw: r.name, actual: r.actual,
      done: r.status === "Achieved" || r.actual >= 1 - 1e-9 || (r.actFinish !== undefined && r.actFinish !== null) });
  }
  if (phases.length < 1 && !errors.length) errors.push("No phases found in Dashboard section 1");
  if (milestones.length < 1 && !errors.length) errors.push("No key milestones found (rows 1.1.x)");

  // Milestone ring = the milestone's own Actual % from the workbook (100 when achieved).
  const msOut = [];
  for (const mr of [...milestones].sort((a, b) => a.due - b.due)) {
    const pct = mr.done ? 100 : pyRound(mr.actual * 100, 0);
    msOut.push([fmtDate(mr.due), cleanName(mr.raw), mr.done ? 1 : 0, pct]);
  }

  // ---- S-curve
  const sc = [];
  let prev = -1;
  for (let i = 0; i < TOTAL_WEEKS; i++) {
    const row = raw.curve[i];
    if (!Array.isArray(row) || row.length !== 4) { errors.push(`S-curve week ${i + 1}: missing or wrong row`); break; }
    const [wk, ws, pc, ac] = row;
    const wstart = parseISO(ws);
    if (wk !== i + 1 || wstart === null || !isNum(pc)) { errors.push(`S-curve week ${i + 1}: missing or wrong row`); break; }
    if (pc < 0 || pc > 1.0000001 || pc + 1e-9 < prev) { errors.push(`S-curve week ${i + 1}: planned % must rise from 0 to 100`); break; }
    prev = pc;
    let act = null;
    if (dataDate !== null && wstart <= dataDate) {
      if (!isNum(ac) || ac < 0 || ac > 1.0000001) { errors.push(`S-curve week ${i + 1}: actual % missing or out of range`); break; }
      act = pyRound(ac * 100, 2);
    }
    sc.push([i + 1, "", pyRound(pc * 100, 2), act]);
  }
  if (sc.length === TOTAL_WEEKS && sc[TOTAL_WEEKS - 1][2] !== 100) errors.push("S-curve planned % must reach 100 in the final week");
  if (!errors.length && Number.isInteger(week) && sc[week - 1][3] !== null && Math.abs(sc[week - 1][3] - pyRound(actual * 100, 2)) > 0.01) {
    errors.push("S-curve actual for the report week does not match the overall actual");
  }
  if (errors.length) throw new ValidationError(errors);

  const firstWeekEnd = parseISO(raw.curve[0][1]) + 6 * DAY;
  return {
    template_version: "WPR-v1",
    client: { id: project.client_id, token: clientToken, name: cap(clientToken) },
    project: { id: project.project_id, code, phase: phaseNo, name_short: `${code} ${facShort}`, name_long: `${code} ${facLong}` },
    dates: { data_date: isoOf(dataDate), start: isoOf(start), finish: isoOf(finish), first_week_end: isoOf(firstWeekEnd) },
    week, total_weeks: TOTAL_WEEKS, days_left: daysLeft,
    overall: { planned: pyRound(planned * 100, 1), actual: pyRound(actual * 100, 1), variance: pyRound((actual - planned) * 100, 1), spi: pyRound(spi, 2) },
    D: { sc, ms: msOut, ph: phases },
  };
}
