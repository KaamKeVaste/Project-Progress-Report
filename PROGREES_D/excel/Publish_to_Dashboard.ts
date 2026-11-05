// Publish to Dashboard: the ONLY script. Link it to the green button in every project workbook.
// It reads the progress cells, checks them, sends them to the ONE Power Automate flow, and writes the result in M6:M8.
// Setup per workbook: the hidden "_config" sheet. B1 = Publish URL (from the flow), B2 = Project key (from /admin), B3 = Publisher name.

interface Phase { wbs: string; name: string; planned: number; actual: number; finish: string; actFinish: string | null; status: string; }
interface Milestone { wbs: string; name: string; due: string; actual: number; actFinish: string | null; status: string; }
interface PublishResult { ok?: boolean; project?: string; week?: number; data_date?: string; error?: string; errors?: string[]; }
type Cell = string | number | boolean;

async function main(workbook: ExcelScript.Workbook) {
    const ds = workbook.getWorksheet("Dashboard");
    if (!ds) { throw new Error("This workbook has no sheet called Dashboard."); }
    const statusCell = ds.getRange("M8");
    const show = (text: string, state: string) => {
        statusCell.setValue(text);
        const fill = statusCell.getFormat().getFill();
        if (state === "ok") { fill.setColor("#D9F2E3"); }
        else if (state === "bad") { fill.setColor("#FDE2E2"); }
        else { fill.setColor("#FFF4CC"); }
    };

    // ---- 1. settings for this workbook
    let cfg = workbook.getWorksheet("_config");
    if (!cfg) {
        cfg = workbook.addWorksheet("_config");
        cfg.getRange("A1:B4").setValues([
            ["Publish URL (from the Power Automate flow)", ""],
            ["Project key (from the website's /admin page)", ""],
            ["Publisher name (shown on the website)", ""],
            ["Do not share this sheet. The key only works for this project.", ""],
        ]);
        cfg.getRange("A:A").getFormat().setColumnWidth(330);
        cfg.getRange("B:B").getFormat().setColumnWidth(420);
        cfg.activate();
        show("SETUP NEEDED: fill in B1, B2 and B3 on the _config sheet, then click Publish again", "bad");
        return;
    }
    const url = String(cfg.getRange("B1").getValue()).trim();
    const projectKey = String(cfg.getRange("B2").getValue()).trim();
    const by = String(cfg.getRange("B3").getValue()).trim().slice(0, 80);
    if (url.indexOf("https://") !== 0) { show("SETUP NEEDED: _config!B1 must contain the Publish URL (starts with https://)", "bad"); return; }
    if (projectKey.length < 10) { show("SETUP NEEDED: _config!B2 must contain the project key from the admin page", "bad"); return; }

    // ---- 2. read and check the progress data (only these cells are read; no remarks, RAID or weights)
    const errors: string[] = [];
    const num = (v: Cell): number | null => (typeof v === "number" ? v : null);
    const day = (v: Cell): string | null =>
        typeof v === "number" ? new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10) : null;

    const title = String(ds.getRange("B3").getValue());
    const dataDate = day(ds.getRange("D7").getValue());
    const week = num(ds.getRange("E7").getValue());
    const start = day(ds.getRange("G7").getValue());
    const finish = day(ds.getRange("H7").getValue());
    const daysLeft = num(ds.getRange("I7").getValue());
    const planned = num(ds.getRange("B10").getValue());
    const actual = num(ds.getRange("D10").getValue());
    const spi = num(ds.getRange("H10").getValue());

    if (!dataDate || !start || !finish) { errors.push("Data date (D7), start or finish date is missing"); }
    if (week === null || week < 1 || week % 1 !== 0) { errors.push("Report week (E7) must be a whole number"); }
    if (planned === null || planned < 0 || planned > 1) { errors.push("Overall planned % (B10) must be between 0 and 100"); }
    if (actual === null || actual < 0 || actual > 1) { errors.push("Overall actual % (D10) must be between 0 and 100"); }
    if (spi === null) { errors.push("SPI (H10) is missing"); }

    const rows = ds.getRange("B16:O300").getValues();
    const phases: Phase[] = [];
    const milestones: Milestone[] = [];
    for (const r of rows) {
        const wbs = String(r[0]).trim();
        if (wbs.indexOf("2.") === 0) { break; }
        const p = num(r[7]);
        const a = num(r[8]);
        const fin = day(r[4]);
        const status = String(r[13]).trim();
        if (/^1\.\d+$/.test(wbs) && wbs !== "1.1") {
            if (p === null || a === null || p < 0 || p > 1 || a < 0 || a > 1) { errors.push("Phase " + wbs + ": % must be between 0 and 100"); }
            else if (!fin) { errors.push("Phase " + wbs + ": finish date is missing"); }
            else { phases.push({ wbs: wbs, name: String(r[1]).trim(), planned: p, actual: a, finish: fin, actFinish: day(r[6]), status: status }); }
        } else if (/^1\.1\.\d+$/.test(wbs)) {
            const name = String(r[1]).trim();
            if (name.indexOf("◆") !== 0) { errors.push("Milestone " + wbs + ": name must start with the ◆ diamond"); }
            else if (!fin) { errors.push("Milestone " + wbs + ": due date is missing"); }
            else if (a === null || a < 0 || a > 1) { errors.push("Milestone " + wbs + ": % must be between 0 and 100"); }
            else { milestones.push({ wbs: wbs, name: name, due: fin, actual: a, actFinish: day(r[6]), status: status }); }
        }
    }
    if (phases.length === 0) { errors.push("No phases found on the Dashboard sheet"); }
    if (milestones.length === 0) { errors.push("No key milestones (1.1.x) found"); }

    const sc = workbook.getWorksheet("S-Curve (Data)");
    const curve: (string | number | null)[][] = [];
    if (!sc) { errors.push("Sheet 'S-Curve (Data)' is missing"); }
    else {
        const scv = sc.getRange("A13:H272").getValues();
        for (let i = 0; i < scv.length; i++) {
            if (scv[i][0] === "" || scv[i][0] === null) { break; }
            const wk = num(scv[i][0]);
            const ws = day(scv[i][1]);
            const pc = num(scv[i][3]);
            if (wk !== i + 1 || !ws || pc === null) { errors.push("S-curve week " + (i + 1) + " is missing or wrong"); break; }
            curve.push([wk, ws, pc, num(scv[i][7])]);
        }
        if (curve.length < 2) { errors.push("S-curve has no weeks"); }
        if (week !== null && week > curve.length) { errors.push("Report week is beyond the last S-curve week"); }
    }

    if (errors.length > 0) { show("NOT PUBLISHED: " + errors[0], "bad"); return; }

    // ---- 3. send to the flow and show the answer
    const snapshot = { title: title, dataDate: dataDate, week: week, start: start, finish: finish, daysLeft: daysLeft,
        planned: planned, actual: actual, spi: spi, phases: phases, milestones: milestones, curve: curve };
    const body = JSON.stringify({ v: 1, projectKey: projectKey, by: by, snapshot: snapshot });
    if (body.length > 110000) { show("NOT PUBLISHED: data too large", "bad"); return; }
    show("Publishing… please wait", "wait");

    let status = 0;
    let text = "";
    try {
        // text/plain keeps this a simple request, so no browser pre-check is needed before it is sent
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: body });
        status = res.status;
        text = await res.text();
    } catch (e) {
        show("NOT PUBLISHED: could not reach the publishing service. Check _config!B1, then try again.", "bad");
        return;
    }
    let r: PublishResult = {};
    try { r = JSON.parse(text) as PublishResult; } catch (e) { r = {}; }

    if (status >= 200 && status < 300 && r.ok === true) {
        const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
        ds.getRange("M6").setValue(ist.toISOString().replace("T", " ").slice(0, 16) + " IST");
        ds.getRange("M7").setValue(by);
        show("✓ Published · Week " + String(r.week) + " · data date " + String(r.data_date), "ok");
        cfg.setVisibility(ExcelScript.SheetVisibility.hidden);
        ds.activate();
    } else {
        let msg = "";
        if (r.errors && r.errors.length > 0) { msg = r.errors[0]; }
        else if (r.error) { msg = r.error; }
        else { msg = "the service answered " + String(status); }
        show("NOT PUBLISHED: " + msg, "bad");
    }
}
