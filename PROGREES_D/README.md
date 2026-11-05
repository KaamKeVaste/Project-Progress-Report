# Kewaunee Project Dashboards — v3 (one script, one flow, any number of projects)

```
Excel workbook (any project)         Power Automate (ONE flow)              Netlify website
 green button → 1 script   ──POST──▶  "When an HTTP request is received" ──▶ /api/publish ──▶ /p/<CODE>
 shows ✓ / ✗ in M8        ◀─answer─  adds the master key, returns answer  ◀─  checks both keys + all data rules
```

* **1 Office Script** (`excel/Publish_to_Dashboard.ts`) in every workbook. No Get Snapshot / Mark Published any more.
* **1 flow** for all projects. It only runs when someone clicks Publish, so it uses none of Power Automate's
  1,600 "Run script" calls per day.
* **New project = admin page + copy workbook.** No code change, no redeploy, no new flow.
* Every number, name, date and chart comes from the workbook (same rules as v2).

## Security model
| Lock | Where it lives | What it stops |
|---|---|---|
| Master key `PUBLISH_KEY` | Netlify + inside the one flow only | Anyone posting straight to the website |
| Project key `pk_…` | Netlify derives it; the workbook keeps it in the hidden `_config` sheet | One project publishing as another; the flow address alone publishing anything |
| Viewer password | Admin page (stored as a salted PBKDF2 hash) or `PW_<CODE>` variable | Viewers opening other projects |
| Admin key `ADMIN_KEY` | Netlify only | Anyone adding or changing projects |

Wrong keys and passwords are rate-limited and logged. Only allow-listed fields are accepted; remarks, RAID, weights and owners are never sent.
Only the authorised editor of a workbook can see its `_config` sheet, which is acceptable because viewers only use the website.

---
## One-time setup (about 20 minutes)

### 1. Website (GitHub → Netlify)
1. GitHub repo → **Add file → Upload files** → drag the `netlify` and `public` folders and `netlify.toml`, `package.json`,
   `package-lock.json`, `README.md`. Same names are replaced. Delete `netlify/lib/labels.mjs` if it is still there. **Commit**.
2. Netlify → **Environment variables** → add `ADMIN_KEY` (secret, 24+ characters). To make one, open Make_Secrets.html, click **New** next to PUBLISH_KEY, and copy that value. Don't change your real PUBLISH_KEY.
   Keep `PUBLISH_KEY`, `SESSION_SECRET`, `PW_ORB2` as they are.
3. **Deploys → Trigger deploy**. Open `https://<your-site>/admin`: you should see the "Add or update a project" form.

### 2. The ONE flow (Power Automate)
1. **Create → Create from blank (Instant/Automated)**. Trigger: **When an HTTP request is received**.
   * *Who can trigger the flow*: **Anyone**. (If your company blocks this, ask IT; see "If Excel cannot reach the flow" below.)
   * Leave the JSON schema empty.
2. **+ New step → HTTP**
   * Method **POST**, URI `https://<your-site>/api/publish`
   * Headers: `Content-Type` = `application/json` and `x-publish-key` = your **PUBLISH_KEY**
   * Body: Dynamic content → trigger **Body**
   * **Settings → Retry policy → None**
3. **+ New step → Response** (Request connector)
   * Status code: expression `outputs('HTTP')?['statusCode']`
   * Headers: `Content-Type` = `application/json` and `Access-Control-Allow-Origin` = `*`
   * Body: Dynamic content → **Body** of **HTTP**
   * **Settings → Run after**: tick **is successful**, **has failed** and **has timed out**
4. **Save**. Open the trigger again and copy the **HTTP POST URL**. That is the *Publish URL* for every workbook.
   Treat it like a password.

### 3. Template workbook
1. Copy a finished workbook (for example ORB2) and name it `TEMPLATE-WPR.xlsx`.
2. **Automate → Publish to Dashboard → Edit**: replace all the code with `excel/Publish_to_Dashboard.ts` → **Save**.
3. Keep the green button linked to **Publish to Dashboard** (if it is missing: script **⋯ → Add in workbook**).
4. Click the button once: it creates the `_config` sheet. Put the **Publish URL** in **B1**. Leave B2 empty in the template.
5. Delete the old `_publish` sheet if present.

### 4. Move ORB2 to v3
1. Do step 3.2 in the ORB2 workbook too.
2. `/admin` → code `ORB2`, client `ORION`, action **Only show the project key** → paste the key into `_config!B2`; your name in `B3`.
3. Click **Run Publish to Dashboard**: M8 turns green with "✓ Published · Week …".
4. Turn **off** the old flow ("Publish Dashboard – ORB2 test"). The scripts **Get Snapshot** and **Mark Published** can be deleted.

---
## Every new project (about 3 minutes)
1. **/admin**: project code (e.g. `AGV1`), client name (e.g. `AMGEN`), viewer password, client logo PNG → **Save project**.
   Copy the project key it shows.
2. **SharePoint**: copy `TEMPLATE-WPR.xlsx` into the project folder, rename it.
3. **Excel**: title in **Schedule!B3** → `PROJECT : AMGEN - AGV1-R&D LAB - PHASE I`; paste the key in **_config!B2**; your name in **B3**.
4. Click **Run Publish to Dashboard** → share `https://<your-site>/p/AGV1` and the viewer password.

## Weekly use (general user)
Update the Schedule sheet → set the data date in **Dashboard!D7** → click the green button → M8 shows
✓ (green) or the reason it was not published (red). Nothing else.

## What M8 can say
| M8 | Meaning |
|---|---|
| ✓ Published · Week N · data date … | The website now shows this week |
| SETUP NEEDED: … | `_config` B1/B2 missing |
| NOT PUBLISHED: (reason) | A check in Excel or on the website failed; the website keeps the last good week |
| NOT PUBLISHED: … does not belong to project … | Wrong project key in `_config!B2` |
| NOT PUBLISHED: Week N is older … | You tried to publish an earlier week |
| NOT PUBLISHED: could not reach the publishing service | Wrong Publish URL, flow off, or the network blocked it |

## If Excel cannot reach the flow
Some company networks stop Excel scripts calling Power Automate. Then either ask IT to allow it, or use **direct mode**:
add Netlify variable `ALLOW_DIRECT` = `1`, redeploy, and put `https://<your-site>/api/publish` in `_config!B1`.
The project key is still required; only the flow step is skipped.

## Optional variables
| Variable | Effect |
|---|---|
| `ALLOW_DIRECT=1` | Excel may publish straight to the website (see above) |
| `LEGACY_PUBLISH=1` | Accept the old 3-script flow during a migration (no project key) |

## Tests
`npm ci && npm test` → 41 checks (data rules, security, admin page, project keys, both flow body formats).
