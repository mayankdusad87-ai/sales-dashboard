// GET /api/data — reads the Google Sheet with a service account, drops personal columns,
// returns the cleaned dataset. Cached in memory for CACHE_SECONDS (default 300).
const { JWT } = require("google-auth-library");
const XLSX = require("xlsx");
const { cleanAll, TABS } = require("../lib/clean");

const CACHE_MS = (+process.env.CACHE_SECONDS || 300) * 1000;
let cache = { at: 0, body: null, pending: null };

function client() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const key = JSON.parse(raw);
  return new JWT({ email: key.client_email, key: key.private_key, scopes: ["https://www.googleapis.com/auth/drive.readonly"] });
}

async function load() {
  const id = process.env.SHEET_FILE_ID;
  if (!id) throw new Error("SHEET_FILE_ID is not set");
  const auth = client();
  const base = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id);
  const meta = (await auth.request({ url: base, params: { fields: "name,mimeType,modifiedTime", supportsAllDrives: true } })).data;
  const isNative = meta.mimeType === "application/vnd.google-apps.spreadsheet";
  const file = await auth.request({
    url: isNative ? base + "/export" : base,
    params: isNative
      ? { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
      : { alt: "media", supportsAllDrives: true },
    responseType: "arraybuffer"
  });
  const wb = XLSX.read(Buffer.from(file.data), { type: "buffer", cellDates: true, dense: true });
  const find = (name) => wb.SheetNames.find((n) => n.trim().toLowerCase() === name.toLowerCase());
  const tab = (name) => {
    const n = find(name);
    return n ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "", blankrows: false }) : [];
  };
  const missing = Object.values(TABS).filter((n) => !find(n));
  const data = cleanAll(
    { walkin: tab(TABS.walkin), closing: tab(TABS.closing), sourcing: tab(TABS.sourcing), inventory: tab(TABS.inventory) },
    { asOf: new Date().toISOString(), file: meta.name }
  );
  data.sheetModified = meta.modifiedTime;
  data.missingTabs = missing;
  return JSON.stringify(data);
}

module.exports = async (req, res) => {
  const pass = process.env.DASHBOARD_PASSWORD;
  if (pass && req.headers["x-dashboard-key"] !== pass) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "password" }));
    return;
  }
  try {
    const fresh = req.query && req.query.fresh === "1";
    if (!cache.body || fresh || Date.now() - cache.at > CACHE_MS) {
      if (!cache.pending) cache.pending = load().then((b) => { cache = { at: Date.now(), body: b, pending: null }; return b; }, (e) => { cache.pending = null; throw e; });
      await cache.pending;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.end(cache.body);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "load", message: String(e.message || e) }));
  }
};
