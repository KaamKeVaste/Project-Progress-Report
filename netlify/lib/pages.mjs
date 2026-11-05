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

