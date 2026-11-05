import { pageShell, esc } from "./util.mjs";

export function loginPage(code, error) {
  return pageShell("Sign in", `<h1>Project dashboard</h1><p>Enter the password for project <b>${esc(code)}</b>.</p>
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}
<form method="post" action="/api/login" autocomplete="off">
<input type="hidden" name="project" value="${esc(code)}">
<label for="pw">Password</label><input id="pw" name="password" type="password" required maxlength="200" autofocus>
<button type="submit">View dashboard</button></form>
<p class="small">Access is logged. Your session closes after 30 minutes.</p>`);
}


const ADMIN_CSS = `<style>.card{max-width:520px}input[type=text],input[type=file],select{width:100%;padding:11px;border:1px solid #c5cfdb;border-radius:8px;font-size:15px;background:#fff}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:480px){.row{grid-template-columns:1fr}}
.hint{font-size:12px;color:#6b7a8c;margin:4px 0 0}.key{font-family:Consolas,monospace;font-size:15px;background:#0C1F35;color:#cfe6ff;padding:12px;border-radius:8px;word-break:break-all;user-select:all}
ol{padding-left:18px;font-size:14px;line-height:1.55;color:#33475b}.ok{background:#e3f4ea;color:#14633d;border-radius:8px;padding:10px 12px;font-size:13px;margin:0 0 10px}</style>`;

export function adminPage(error) {
  return pageShell("Project admin", `${ADMIN_CSS}<h1>Add or update a project</h1>
<p>Projects added here appear on the website at once. No code change or redeploy is needed.</p>
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}
<form method="post" action="/api/admin" enctype="multipart/form-data" autocomplete="off">
<label for="ak">Admin key</label><input id="ak" name="admin_key" type="password" required maxlength="200">
<div class="row"><div><label for="code">Project code</label><input id="code" name="code" type="text" required maxlength="12" placeholder="AGV1">
<p class="hint">As in the title: PROJECT : CLIENT - <b>CODE</b>-Name - PHASE I</p></div>
<div><label for="ct">Client name</label><input id="ct" name="client_token" type="text" maxlength="40" placeholder="AMGEN">
<p class="hint">The word after “PROJECT :”</p></div></div>
<label for="pw">Viewer password</label><input id="pw" name="password" type="password" maxlength="200" placeholder="10+ characters (leave empty to keep)">
<label for="logo">Client logo (PNG, under 300 KB)</label><input id="logo" name="logo" type="file" accept="image/png">
<label for="ac">Action</label><select id="ac" name="action"><option value="save">Save project</option><option value="key">Only show the project key</option></select>
<button type="submit">Continue</button></form>
<p class="small">Every change is logged.</p>`);
}

export function adminResult(code, key, created, source) {
  return pageShell("Project saved", `${ADMIN_CSS}<h1>Project ${esc(code)}</h1>
<div class="ok">${created ? "Project created." : source === "code" ? "Project found." : "Project saved."}</div>
<label>Project key (paste into the workbook's <b>_config</b> sheet, cell B2)</label><div class="key">${esc(key || "PUBLISH_KEY is not set")}</div>
<label>Viewer link</label><div class="key">/p/${esc(code)}</div>
<ol><li>Copy the template workbook for this project.</li><li>Type the title in Schedule!B3 with code <b>${esc(code)}</b>.</li>
<li>Paste the key above into <b>_config!B2</b>.</li><li>Click <b>Run Publish to Dashboard</b>.</li></ol>
<p class="small">Keep this key private. It only works for project ${esc(code)}.</p>
<p><a href="/admin">Add another project</a></p>`);
}
