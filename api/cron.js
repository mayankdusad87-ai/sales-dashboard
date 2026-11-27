// GET /api/cron — called by Vercel Cron every day at 03:30 UTC (9:00 AM India time), see vercel.json.
// Sends the automatic emails due today (lib/auto.js): the monthly report on the 1st, the mid-month report on the 15th.
// Needs two settings in Vercel (never in the code or chat):
//   CRON_SECRET               - any long random text; Vercel sends it with each cron call, so nobody else can trigger this
//   SUPABASE_SERVICE_ROLE_KEY - lets the server read people and rights and write the send history without a user signed in
// The same email for the same period is never sent twice (send history + the email service's idempotency key).
const { getData, SB } = require("./data");
const { build } = require("../lib/report");
const auto = require("../lib/auto");

const FROM = process.env.EMAIL_FROM || "Raghav Realty Control Tower <noreply@raghavgroup.in>";
const SITE = process.env.SITE_URL || "https://sales-dashboard-pi-one.vercel.app";

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET, svc = process.env.SUPABASE_SERVICE_ROLE_KEY, key = process.env.RESEND_API_KEY;
  if (!secret || String(req.headers.authorization || "") !== "Bearer " + secret) return send(res, 401, { error: "not allowed" });
  if (!svc || !key) return send(res, 500, { error: "config", message: "SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY must be set in Vercel" });
  const due = auto.dueToday();
  if (!due.length) return send(res, 200, { sent: [], message: "Nothing due today" });

  // new Supabase secret keys (sb_secret_…) go in the apikey header only; legacy service_role keys (eyJ…) also as Bearer
  const h = /^sb_secret_/.test(svc) ? { apikey: svc, "Content-Type": "application/json" } : { apikey: svc, Authorization: "Bearer " + svc, "Content-Type": "application/json" };
  const get = async (path) => { const r = await fetch(SB.url + "/rest/v1/" + path, { headers: h }); if (!r.ok) throw new Error("Supabase " + r.status); return r.json(); };
  const log = (row) => fetch(SB.url + "/rest/v1/email_sends", { method: "POST", headers: Object.assign({ Prefer: "return=minimal" }, h), body: JSON.stringify(row) }).catch((e) => console.error("email_sends", e));

  let members, access, data;
  try { [members, access] = await Promise.all([get("members?select=email,is_admin,active"), get("access?select=*")]); data = await getData(false); }
  catch (e) { console.error(e); return send(res, 502, { error: "load", message: String(e.message || e).slice(0, 200) }); }

  const out = [];
  for (const which of due) {
    const job = auto.JOBS[which], per = auto.periodOf(which), R = auto.recipients(which, members, access);
    let built;
    try { built = build(data, { ym: per.ym, to: per.to || undefined, projects: ["*"], url: SITE }); }
    catch (e) { await log({ job_name: job.name, period: per.ym, kind: "auto", to_count: 0, ok: false, error: "build: " + String(e.message || e).slice(0, 250), sent_by: "automatic" }); out.push({ which, ok: false }); continue; }
    // already sent for this period?
    const done = await get("email_sends?select=id&kind=eq.auto&ok=is.true&job_name=eq." + encodeURIComponent(job.name) + "&period=eq." + encodeURIComponent(built.period) + "&limit=1").catch(() => []);
    if (done.length) { out.push({ which, skipped: "already sent" }); continue; }
    const count = R.to.length + R.cc.length + R.bcc.length;
    if (!R.to.length) { await log({ job_name: job.name, period: built.period, kind: "auto", to_count: 0, ok: false, error: "No recipients: nobody has the rights for this email", sent_by: "automatic" }); out.push({ which, ok: false }); continue; }
    let ok = false, err = "";
    try {
      const msg = { from: FROM, to: R.to, subject: built.subject, html: built.html, headers: { "X-Entity-Ref-ID": "auto-" + which + "-" + built.period } };
      if (R.cc.length) msg.cc = R.cc; if (R.bcc.length) msg.bcc = R.bcc;
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "Idempotency-Key": "auto-" + which + "-" + built.period }, body: JSON.stringify(msg) });
      const j = await r.json().catch(() => ({}));
      ok = r.ok; if (!ok) err = String(j.message || j.error || "Resend said " + r.status).slice(0, 300);
    } catch (e) { err = String(e.message || e).slice(0, 300); }
    await log({ job_name: job.name, period: built.period, kind: "auto", to_count: count, ok, error: err || null, sent_by: "automatic" });
    out.push({ which, ok, count });
  }
  return send(res, 200, { sent: out });
};
