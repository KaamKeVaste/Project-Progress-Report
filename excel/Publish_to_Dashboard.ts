interface Phase { wbs: string; name: string; planned: number; actual: number; finish: string; actFinish: string | null; status: string; }
interface Milestone { wbs: string; name: string; due: string; actual: number; actFinish: string | null; status: string; }
type Cell = string | number | boolean;

function main(workbook: ExcelScript.Workbook) {
    const ds = workbook.getWorksheet("Dashboard");
    const sc = workbook.getWorksheet("S-Curve (Data)");
    const errors: string[] = [];

    const num = (v: Cell): number | null => (typeof v === "number" ? v : null);
    const day = (v: Cell): string | null =>
        typeof v === "number" ? new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10) : null;

    // ---- headline numbers (only these cells are read)
    const title = String(ds.getRange("B3").getValue());
    const dataDate = day(ds.getRange("D7").getValue());
    const week = num(ds.getRange("E7").getValue());
    const start = day(ds.getRange("G7").getValue());
    const finish = day(ds.getRange("H7").getValue());
    const daysLeft = num(ds.getRange("I7").getValue());
    const planned = num(ds.getRange("B10").getValue());
    const actual = num(ds.getRange("D10").getValue());
    const spi = num(ds.getRange("H10").getValue());

    if (!dataDate || !start || !finish) errors.push("Data date, start or finish date is missing");
    if (week === null || week < 1 || week % 1 !== 0) errors.push("Report week must be a whole number");
    if (planned === null || planned < 0 || planned > 1) errors.push("Overall planned % must be between 0 and 100");
    if (actual === null || actual < 0 || actual > 1) errors.push("Overall actual % must be between 0 and 100");
    if (spi === null) errors.push("SPI is missing");

    // ---- phases (1.x) and key milestones (1.1.x); stops before section 2 (RAID log)
    const rows = ds.getRange("B16:O300").getValues();
    const phases: Phase[] = [];
    const milestones: Milestone[] = [];
    for (const r of rows) {
        const wbs = String(r[0]).trim();
        if (wbs.indexOf("2.") === 0) break;
        const p = num(r[7]);
        const a = num(r[8]);
        const fin = day(r[4]);
        const status = String(r[13]).trim();
        if (/^1\.\d+$/.test(wbs) && wbs !== "1.1") {
            if (p === null || a === null || p < 0 || p > 1 || a < 0 || a > 1) errors.push("Phase " + wbs + ": % must be between 0 and 100");
            else if (!fin) errors.push("Phase " + wbs + ": finish date is missing");
            else phases.push({ wbs, name: String(r[1]).trim(), planned: p, actual: a, finish: fin, actFinish: day(r[6]), status });
        } else if (/^1\.1\.\d+$/.test(wbs)) {
            const name = String(r[1]).trim();
            if (name.indexOf("◆") !== 0) errors.push("Milestone " + wbs + ": name must start with the diamond");
            else if (!fin) errors.push("Milestone " + wbs + ": due date is missing");
            else if (a === null || a < 0 || a > 1) errors.push("Milestone " + wbs + ": % must be between 0 and 100");
            else milestones.push({ wbs, name, due: fin, actual: a, actFinish: day(r[6]), status });
        }
    }
    if (phases.length === 0) errors.push("No phases found");
    if (milestones.length === 0) errors.push("No key milestones found");

    // ---- weekly S-curve: reads every week row until column A is empty (any project length)
    const scv = sc.getRange("A13:H272").getValues();
    const curve: (string | number | null)[][] = [];
    for (let i = 0; i < scv.length; i++) {
        if (scv[i][0] === "" || scv[i][0] === null) break;
        const wk = num(scv[i][0]);
        const ws = day(scv[i][1]);
        const pc = num(scv[i][3]);
        if (wk !== i + 1 || !ws || pc === null) { errors.push("S-curve week " + (i + 1) + " is missing or wrong"); break; }
        curve.push([wk, ws, pc, num(scv[i][7])]);
    }

    if (curve.length < 2) errors.push("S-curve has no weeks");
    if (week !== null && week > curve.length) errors.push("Report week is beyond the last S-curve week");

    // ---- stop here if anything is wrong
    const statusCell = ds.getRange("M8");
    if (errors.length > 0) {
        statusCell.setValue("NOT PUBLISHED: " + errors[0]);
        return;
    }

    // ---- freeze the safe data into a hidden sheet
    const snapshot = JSON.stringify({ title, dataDate, week, start, finish, daysLeft, planned, actual, spi, phases, milestones, curve });
    if (snapshot.length > 30000) {
        statusCell.setValue("NOT PUBLISHED: data too large");
        return;
    }
    const sheet = workbook.getWorksheet("_publish") || workbook.addWorksheet("_publish");
    sheet.getRange("A1").setValue(snapshot);
    sheet.getRange("B1").setValue(String(Date.now()));
    sheet.setVisibility(ExcelScript.SheetVisibility.hidden);

    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    ds.getRange("M6").setValue(ist.toISOString().replace("T", " ").slice(0, 16) + " IST");
    statusCell.setValue("Publish requested");
}