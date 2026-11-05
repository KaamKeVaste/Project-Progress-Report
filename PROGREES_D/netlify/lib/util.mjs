// Small helpers shared by all functions. No dependencies.
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

// Round like Python's round(): half-to-even on exact ties (keeps numbers identical to the approved demo).
export function pyRound(x, nd = 0) {
  const m = 10 ** nd;
  const y = x * m;
  const f = Math.floor(y);
  const d = y - f;
  let r;
  if (d === 0.5) r = f % 2 === 0 ? f : f + 1;
  else r = Math.round(y);
  return r / m;
}
export function fixed(x, nd) {
  const r = pyRound(x, nd);
  return (Object.is(r, -0) ? 0 : r).toFixed(nd);
}

export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;")
    .replace(/`/g, "&#96;").replace(/\$/g, "&#36;").replace(/\\/g, "&#92;");
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export function parseISO(s) {
  const m = typeof s === "string" ? ISO.exec(s) : null;
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return t; // ms since epoch (UTC midnight)
}
export const DAY = 86400000;
export function isoOf(t) { return new Date(t).toISOString().slice(0, 10); }
export function fmtDate(t) {
  const d = new Date(t);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function parseFmt(s) { // "06 Nov 2026" -> ms
  const [dd, mon, yy] = s.split(" ");
  return Date.UTC(+yy, MON.indexOf(mon), +dd);
}

// JSON with Python-style spacing and ASCII-only output, safe to embed inside a <script> tag.
export function pyJson(v) {
  if (Array.isArray(v)) return "[" + v.map(pyJson).join(", ") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).map((k) => pyJson(String(k)) + ": " + pyJson(v[k])).join(", ") + "}";
  }
  if (typeof v === "string") {
    return JSON.stringify(v).replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  }
  return JSON.stringify(v);
}

export const SECURITY_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};
export const CSP_DASHBOARD =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; base-uri 'none'; " +
  "form-action 'self'; frame-ancestors 'none'";
export const CSP_PLAIN =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function html(body, status = 200, csp = CSP_PLAIN, extra = {}) {
  return new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp, ...extra },
  });
}
export function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}
export function pageShell(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>
:root{--navy:#0C1F35;--blue:#1357A8;--red:#DE1F26;--bg:#F3F5F8}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);
font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--navy);padding:16px}
.card{background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(12,31,53,.12);padding:28px;width:100%;max-width:380px;border-top:5px solid var(--blue)}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#4b5b6e;font-size:14px;line-height:1.45}
label{display:block;font-size:13px;font-weight:600;margin:12px 0 6px}
input[type=password]{width:100%;padding:12px;border:1px solid #c5cfdb;border-radius:8px;font-size:16px}
input:focus{outline:2px solid var(--blue);border-color:var(--blue)}
button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:8px;background:var(--blue);color:#fff;font-weight:700;font-size:15px;cursor:pointer}
.err{background:#fdecec;color:#a4161b;border-radius:8px;padding:10px 12px;font-size:13px;margin:0 0 8px}
.small{font-size:12px;color:#6b7a8c;margin-top:14px}</style></head><body><main class="card">${inner}</main></body></html>`;
}
