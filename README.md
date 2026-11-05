# Kewaunee Project Dashboards — v2 (live from Excel)

Excel on SharePoint → Power Automate → this Netlify site. Every number, name, date and chart on the
dashboard comes from the published workbook. There are no fixed names, milestone mappings or week counts in the code.

## What changed from v1
| Area | v1 | v2 |
|---|---|---|
| Phase & milestone names | Some were renamed in code | Shown exactly as typed in Excel (◆ removed) |
| Milestone ring % | Copied from a linked phase | The milestone's own **Actual %** (100% when achieved, Actual % = 100% or an Actual Finish date) |
| Project length | Fixed at 60 weeks | Number of rows in **S-Curve (Data)**, from row 13 down to the first empty cell in column A (2–260 weeks) |
| Weekly chart axis | Fixed 0–4 % | Scales to the largest weekly value |
| Month labels on the curve | Fixed May…Jun | Worked out from the project dates |
| Add or remove a phase or milestone | Needed a code change | Add or remove the row in Excel and publish |

## What the publish reads (Dashboard sheet)
| Website | Cell | Real input |
|---|---|---|
| Title / client / project code | B3 | Schedule!B3 |
| Data date | D7 | **type it here** |
| Week no. | E7 | formula |
| Start / finish | G7 / H7 | G7 typed, H7 from Schedule |
| Days to finish | I7 | formula |
| Planned / Actual / SPI | B10 / D10 / H10 | from Schedule task rows |
| Phases (1.2, 1.3 …) | rows 16+ (B, C, F, H, I, J, O) | Schedule phase rows (formulas) |
| Milestones (1.1.x) | rows 16+ (B, C, F, H, J, O) | **Schedule rows: Actual % (M), Actual Finish (I), Sch Finish (G)** |
| S-curve | S-Curve (Data) A13:H… | Planned col D (formula), Actual col H (G typed, else F auto) |

Only **task rows** on the Schedule sheet are inputs. Totals, phase rows and the Dashboard sheet are formulas: never type over them.

## Deploy this version
1. **GitHub:** open the repo, click **Add file → Upload files**, then drag the `netlify` and `public` folders and the
   `netlify.toml`, `package.json`, `package-lock.json` and `README.md` files from this zip. Files with the same name are replaced.
   Delete `netlify/lib/labels.mjs` in GitHub (it is no longer used). Click **Commit changes**. Netlify redeploys by itself.
2. **Excel:** open each script under **Automate → All scripts** and replace its code with the file from `excel/`
   (`Publish_to_Dashboard.ts` changed; `Get_Snapshot.ts` and `Mark_Published.ts` are unchanged). Save.
3. **Test:** change a task's Actual % on the Schedule sheet, click **Run Publish to Dashboard**, and check that M6 shows the
   new time and M8 says *Publish requested* → *Published*. Then refresh the website.

Environment variables (`PUBLISH_KEY`, `SESSION_SECRET`, `PW_<CODE>`) and the Power Automate flow stay the same.

## Add another project
1. Add it to `netlify/lib/projects.mjs` (client token from the workbook title, project id, client logo as a PNG data URI).
2. In Netlify, add a new environment variable `PW_<CODE>` (its own password) and redeploy.
3. Copy the flow for that workbook's folder.

## Safety rules (unchanged)
Passwords per project, signed 30-minute sessions, lockouts after repeated wrong passwords or keys, strict payload checks
(unknown fields, markup and out-of-range numbers are refused), and older-week publishes are refused.
Remarks, RAID, weights, owners and internal notes are never sent.

## Tests
`npm ci && npm test` runs 30 checks: the data rules, security rules and the HTTP endpoints.
