// GET /api/data — reads the Google Sheet with a service account, drops personal columns
// (customer name is kept only when DASHBOARD_PASSWORD is set; phone, email and remarks never),
// returns the cleaned dataset. Cached in memory for CACHE_SECONDS (default 300).
const { JWT } = require("google-auth-library");
const XLSX = require("xlsx");
const { cleanAll, TABS } = require("../lib/clean");
const { scope } = require("../lib/scope");

// Sign-in (Supabase). The URL and anon key are public by design; they can be overridden in Vercel.
const SB_URL = process.env.SUPABASE_URL || "https://iqazttfvyaihzktfvuzq.supabase.co";
const SB_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxYXp0dGZ2eWFpaHprdGZ2dXpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUyMzM2MTQsImV4cCI6MjExMDgwOTYxNH0.iGGgHGRH-kE1_QibRoiy3sz8_6M0rE_f0KnPi94zmx4";
// LOGIN_REQUIRED=1 in Vercel: nobody sees data without signing in. Until then, signing in is optional.
const LOGIN = process.env.LOGIN_REQUIRED === "1";

// who is calling, and what they may see (checked against Supabase with the caller's own token)
const who = new Map();
async function whoIs(token) {
  const hit = who.get(token);
  if (hit && Date.now() - hit.at < 60000) return hit.me;
  const h = { apikey: SB_ANON, Authorization: "Bearer " + token };
  const u = await fetch(SB_URL + "/auth/v1/user", { headers: h });
  if (!u.ok) return null;
  const user = await u.json();
  const email = String(user.email || "").toLowerCase();
  const m = await fetch(SB_URL + "/rest/v1/members?select=email,full_name,is_admin,active,access(project,management,site_head)&email=eq." + encodeURIComponent(email), { headers: h });
  const rows = m.ok ? await m.json() : [];
  const r = rows[0];
  const me = !r || !r.active ? { email: email, none: true } : { email: email, name: r.full_name, admin: r.is_admin, access: r.access || [] };
  if (who.size > 500) who.clear();
  who.set(token, { at: Date.now(), me: me });
  return me;
}

const CACHE_MS = (+process.env.CACHE_SECONDS || 300) * 1000;
let cache = { at: 0, body: null, pending: null };
// the cleaned dataset, from memory when it is fresh enough (shared with api/email.js)
async function getData(fresh) {
  if (!cache.body || fresh || Date.now() - cache.at > CACHE_MS) {
    if (!cache.pending) cache.pending = load().then((b) => { cache = { at: Date.now(), body: b, pending: null }; return b; }, (e) => { cache.pending = null; throw e; });
    await cache.pending;
  }
  return cache.body;
}

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
    // customer names are read here but only ever sent to signed-in people with Site Head rights (see lib/scope.js),
    // or to everyone behind the old shared password
    { asOf: new Date().toISOString(), file: meta.name, names: true }
  );
  data.sheetModified = meta.modifiedTime;
  data.missingTabs = missing;
  data.bookingSource = bookings ? "Booking details" : "";
  if (bookingError) data.bookingError = bookingError;
  return data;
}

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

module.exports = async (req, res) => {
  const pass = process.env.DASHBOARD_PASSWORD;
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  let me = null;
  try {
    if (token) {
      me = await whoIs(token);
      if (!me) return send(res, 401, { error: "login" });
      if (me.none) return send(res, 403, { error: "noaccess", email: me.email });
    } else if (LOGIN) {
      return send(res, 401, { error: "login" });
    } else if (pass && req.headers["x-dashboard-key"] !== pass) {
      return send(res, 401, { error: "password" });
    }
  } catch (e) {
    console.error(e);
    return send(res, 502, { error: "auth", message: "Could not check the sign-in. Try again in a minute." });
  }
  try {
    const fresh = req.query && req.query.fresh === "1";
    await getData(fresh);
    // signed in: only that person's projects; old mode: everything, with names only behind the shared password
    if (me) return send(res, 200, scope(cache.body, me));
    if (!cache.pub) cache.pub = JSON.stringify(pass ? cache.body : Object.assign({}, cache.body, { NM: null }));
    return send(res, 200, cache.pub);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "load", message: String(e.message || e) }));
  }
};

// shared with api/email.js
module.exports.getData = getData;
module.exports.whoIs = whoIs;
module.exports.SB = { url: SB_URL, anon: SB_ANON };
