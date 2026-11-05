// GET /p/<CODE>  - the dashboard (only after the viewer signed in to THAT project).
import { verify, sessionSecret, parseCookies, COOKIE, projectCode } from "../lib/auth.mjs";
import { html, pageShell, CSP_DASHBOARD, esc } from "../lib/util.mjs";
import { snaps } from "../lib/store.mjs";
import { PROJECTS } from "../lib/projects.mjs";
import { renderDashboard } from "../lib/render.mjs";
import { loginPage } from "../lib/pages.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const m = /^\/p\/([^/]+)\/?$/.exec(url.pathname);
  const code = projectCode(m ? decodeURIComponent(m[1]) : "");
  if (!code) return html(pageShell("Not found", "<h1>Not found</h1><p>Use the link you were given.</p>"), 404);

  const secret = sessionSecret();
  const sess = verify(parseCookies(req.headers.get("cookie"))[COOKIE], secret);
  if (!sess || sess.p !== code) return html(loginPage(code, ""));   // same page for every project, known or not

  const project = PROJECTS[code];
  const rec = project ? await snaps().get(`${code}/current`, { type: "json" }) : null;
  if (!rec) {
    return html(pageShell("No update yet", `<h1>No update published yet</h1><p>Project <b>${esc(code)}</b> has no published progress yet. Please check back later.</p>`));
  }
  return html(renderDashboard(rec.snapshot, project.logo), 200, CSP_DASHBOARD);
};
export const config = { path: "/p/*" };
