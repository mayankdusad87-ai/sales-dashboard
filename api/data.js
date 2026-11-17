// GET /api/data — reads the Google Sheet with a service account, drops personal columns
// (customer name is kept only when DASHBOARD_PASSWORD is set; phone, email and remarks never),
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

// downloads a Drive file (native Google Sheet or .xlsx) as a workbook
async function workbook(auth, id) {
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
  return { meta, wb: XLSX.read(Buffer.from(file.data), { type: "buffer", cellDates: true, dense: true }) };
}
const rowsOf = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false });

async function load() {
  const id = process.env.SHEET_FILE_ID;
  if (!id) throw new Error("SHEET_FILE_ID is not set");
  const auth = client();
  const { meta, wb } = await workbook(auth, id);
  const find = (name) => wb.SheetNames.find((n) => n.trim().toLowerCase() === name.toLowerCase());
  const tab = (name) => {
    const n = find(name);
    return n ? rowsOf(wb.Sheets[n]) : [];
  };
  // Booking details: a tab of this same workbook (the one with an "Overall Status" heading, preferring a name with
  // "booking"), or else a separate file in BOOKING_FILE_ID. A problem here never stops the dashboard: bookings then
  // fall back to the Walk-in sheet and the reason is reported.
  let bookings = null, bookingError = "";
  const hasStatus = (rows) => rows.slice(0, 10).some((r) => r.some((c) => String(c).toLowerCase().includes("overall status")));
  const known = Object.values(TABS).map((n) => n.toLowerCase());
  const cands = wb.SheetNames.filter((n) => !known.includes(n.trim().toLowerCase()))
    .sort((a, b) => (/booking/i.test(b) ? 1 : 0) - (/booking/i.test(a) ? 1 : 0));
  for (const n of cands) { const rows = rowsOf(wb.Sheets[n]); if (hasStatus(rows)) { bookings = rows; break; } }
  const bid = bookings ? "" : process.env.BOOKING_FILE_ID;
  if (!bookings && cands.some((n) => /booking/i.test(n))) bookingError = "The “" + cands.find((n) => /booking/i.test(n)) + "” tab has no “Overall Status” heading in its first 10 rows";
  if (bid) {
    try {
      const b = (await workbook(auth, bid)).wb;
      for (const n of b.SheetNames) {
        const rows = rowsOf(b.Sheets[n]);
        if (hasStatus(rows)) { bookings = rows; bookingError = ""; break; }
      }
      if (!bookings) bookingError = "No tab with an “Overall Status” heading in Booking details";
    } catch (e) { bookingError = "Could not open Booking details: " + String(e.message || e).slice(0, 160); }
  }
  const missing = Object.values(TABS).filter((n) => !find(n));
  const data = cleanAll(
    { walkin: tab(TABS.walkin), closing: tab(TABS.closing), sourcing: tab(TABS.sourcing), inventory: tab(TABS.inventory), bookings },
    // customer names are sent only when the dashboard is password-protected
    { asOf: new Date().toISOString(), file: meta.name, names: !!process.env.DASHBOARD_PASSWORD }
  );
  data.sheetModified = meta.modifiedTime;
  data.missingTabs = missing;
  data.bookingSource = bookings ? "Booking details" : "";
  if (bookingError) data.bookingError = bookingError;
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
