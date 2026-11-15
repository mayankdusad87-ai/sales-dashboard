# Sales Dashboard (live from Google Sheet)

How it works: the page calls `/api/data`. That Vercel function downloads **All Data.xlsx** from Google Drive with a read-only service account, drops personal columns, cleans the four tabs (Walk-in, Closing Targets, Sourcing Targets, Inventory Status) and returns the numbers. It re-reads the sheet at most every 5 minutes. The page refreshes itself every 5 minutes, and the **Refresh** button forces a fresh read.

KPI rules: see `kpi-logic.md` (kept next to the wireframe).

## Files
| File | What it is |
|---|---|
| `index.html` | The dashboard (Management + Site Head tabs) |
| `api/data.js` | Reads the sheet, password check, 5-minute cache |
| `lib/clean.js` | All cleaning rules (column letters, name aliases, date formats) |
| `package.json`, `vercel.json` | Vercel setup |
| `dev/` | Local testing only; not deployed |

## One-time setup (about 20 minutes)

### 1. Google service account (read-only robot user)
1. Open https://console.cloud.google.com → create a project, e.g. "sales-dashboard".
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **IAM & Admin → Service Accounts → Create service account** (no roles needed).
4. Open it → **Keys → Add key → JSON**. A `.json` file downloads. Keep it private; never put it in GitHub.
   (If Google says key creation is disabled, your Workspace admin must allow service-account keys for this project.)
5. Copy the service account's email (ends in `iam.gserviceaccount.com`).
6. In Google Drive, open **All Data.xlsx → Share** → paste that email → **Viewer** → Send.

### 2. Put the code on GitHub
1. https://github.com/new → private repo, e.g. `sales-dashboard`.
2. **Add file → Upload files** → drag in everything in this folder **except** `dev/` → Commit.

### 3. Deploy on Vercel
1. https://vercel.com/new → import the `sales-dashboard` repo. Framework preset: **Other**. No build command.
2. Before clicking Deploy, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The whole content of the downloaded `.json` key file |
| `SHEET_FILE_ID` | `1RzffI51PP05OzFIRYEOfmrmTAsYG3Grd` |
| `DASHBOARD_PASSWORD` | A password you share with the board / site heads |
| `CACHE_SECONDS` (optional) | `300` (how often the sheet is re-read) |

3. **Deploy**. Open the URL Vercel gives you, enter the password, done.
4. Vercel's free Hobby plan is for non-commercial use; for company use pick the Pro plan.

## Changing things later
- **Sheet edits** show up within 5 minutes; nothing to redeploy.
- **New manager spelling** → add it to `NAME_ALIASES` in `lib/clean.js`.
- **Moved columns** in the Walk-in tab → update the letter map `C` in `lib/clean.js`.
- **Change password** → edit `DASHBOARD_PASSWORD` in Vercel → Redeploy.
