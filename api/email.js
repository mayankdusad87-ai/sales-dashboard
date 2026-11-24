// POST /api/email — admins only.
//   { action: "preview", job }  -> { subject, html, period, stats }
//   { action: "test", job }     -> sends that email to the signed-in admin only, from noreply@raghavgroup.in
//   { action: "send", job }     -> sends the SAVED setup (job.id) to its To/Cc/Bcc for job.ym; recipients come from the database, not the screen
// "job" is the email setup as it stands on the admin screen (saved or not): name, projects, sections, ym (optional).
// Every test send is written to email_sends. Scheduled sending (Phase 3) will reuse buildFor().
const { getData, whoIs, SB } = require("./data");
const { build, lastFullMonth } = require("../lib/report");

const FROM = process.env.EMAIL_FROM || "Raghav Realty Control Tower <noreply@raghavgroup.in>";
const SITE = process.env.SITE_URL || "https://sales-dashboard-pi-one.vercel.app";

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(JSON.stringify(body));
}

// only plain values from the screen are used
function clean(job) {
  job = job && typeof job === "object" ? job : {};
  const projects = Array.isArray(job.projects) ? job.projects.map(String).filter(Boolean).slice(0, 100) : ["*"];
  const s = job.sections && typeof job.sections === "object" ? job.sections : {};
  const sections = {};
  ["decisions", "cards", "channel", "realisation"].forEach((k) => { sections[k] = s[k] !== false; });
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(job.ym || "")) ? job.ym : null;
  return { id: /^[0-9a-f-]{36}$/i.test(String(job.id || "")) ? job.id : null, name: String(job.name || "Sales report").slice(0, 120), projects: projects.length ? projects : ["*"], sections, ym };
}

async function buildFor(job) {
  const data = await getData(false);
  return build(data, { ym: job.ym || lastFullMonth(), projects: job.projects, sections: job.sections, url: SITE });
}

async function logSend(token, row) {
  try {
    await fetch(SB.url + "/rest/v1/email_sends", {
      method: "POST",
      headers: { apikey: SB.anon, Authorization: "Bearer " + token, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row)
    });
  } catch (e) { console.error("email_sends", e); }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method" });
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return send(res, 401, { error: "login" });
  let me;
  try { me = await whoIs(token); } catch (e) { return send(res, 502, { error: "auth", message: "Could not check the sign-in. Try again in a minute." }); }
  if (!me) return send(res, 401, { error: "login" });
  if (me.none || !me.admin) return send(res, 403, { error: "admin", message: "Only admins can preview or send emails." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const job = clean(body.job);

  let out;
  if (body.action !== "send") try { out = await buildFor(job); } catch (e) {
    console.error(e);
    return send(res, 500, { error: "build", message: "Could not build the report: " + String(e.message || e).slice(0, 200) });
  }

  if (body.action === "preview") return send(res, 200, { subject: out.subject, html: out.html, period: out.period, stats: out.stats });

  if (body.action === "send") {
    // the saved setup decides who gets it and what is in it; the screen only picks the month
    if (!job.id) return send(res, 400, { error: "unsaved", message: "Save the email first." });
    let saved;
    try {
      const r = await fetch(SB.url + "/rest/v1/email_jobs?select=*&id=eq." + job.id, { headers: { apikey: SB.anon, Authorization: "Bearer " + token } });
      saved = r.ok ? (await r.json())[0] : null;
    } catch (e) { saved = null; }
    if (!saved) return send(res, 404, { error: "job", message: "This email setup was not found. Reload the page." });
    const ok1 = (l) => (Array.isArray(l) ? l : []).map((s) => String(s).trim().toLowerCase()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
    const to = ok1(saved.to_list), cc = ok1(saved.cc_list).filter((e) => to.indexOf(e) < 0), bcc = ok1(saved.bcc_list).filter((e) => to.indexOf(e) < 0 && cc.indexOf(e) < 0);
    if (!to.length) return send(res, 400, { error: "to", message: "Add at least one To recipient and save." });
    if (to.length + cc.length + bcc.length > 50) return send(res, 400, { error: "many", message: "At most 50 recipients in one email." });
    const key = process.env.RESEND_API_KEY;
    if (!key) return send(res, 500, { error: "config", message: "RESEND_API_KEY is not set in Vercel." });
    const real = clean({ id: saved.id, name: saved.name, projects: saved.projects, sections: saved.sections, ym: job.ym });
    let built;
    try { built = await buildFor(real); } catch (e) { return send(res, 500, { error: "build", message: "Could not build the report: " + String(e.message || e).slice(0, 200) }); }
    // the same email for the same month cannot go out twice within 10 minutes, whoever clicks
    try {
      const since = new Date(Date.now() - 6e5).toISOString();
      const r = await fetch(SB.url + "/rest/v1/email_sends?select=at,sent_by&kind=eq.manual&ok=is.true&job_id=eq." + saved.id + "&period=eq." + built.period + "&at=gte." + encodeURIComponent(since) + "&limit=1", { headers: { apikey: SB.anon, Authorization: "Bearer " + token } });
      const last = r.ok ? (await r.json())[0] : null;
      if (last) return send(res, 409, { error: "already", message: "Already sent in the last 10 minutes by " + (last.sent_by || "an admin") + ". Wait 10 minutes to send it again." });
    } catch (e) { console.error("recent send check", e); }
    // two clicks at the same instant: the email service itself drops the second one
    const once = "ct-" + saved.id + "-" + built.period + "-" + Math.floor(Date.now() / 6e5);
    let ok = false, err = "";
    try {
      const msg = { from: FROM, to, subject: built.subject, html: built.html, headers: { "X-Entity-Ref-ID": once } };
      if (cc.length) msg.cc = cc;
      if (bcc.length) msg.bcc = bcc;
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "Idempotency-Key": once }, body: JSON.stringify(msg) });
      const j = await r.json().catch(() => ({}));
      ok = r.ok;
      if (!ok) err = String(j.message || j.error || "Resend said " + r.status).slice(0, 300);
    } catch (e) { err = String(e.message || e).slice(0, 300); }
    const count = to.length + cc.length + bcc.length;
    await logSend(token, { job_id: saved.id, job_name: saved.name, period: built.period, kind: "manual", to_count: count, ok, error: err || null, sent_by: me.email });
    return ok ? send(res, 200, { sent: true, count, subject: built.subject }) : send(res, 502, { error: "send", message: err });
  }

  if (body.action === "test") {
    const key = process.env.RESEND_API_KEY;
    if (!key) return send(res, 500, { error: "config", message: "RESEND_API_KEY is not set in Vercel." });
    const subject = "[Test] " + out.subject;
    let ok = false, err = "";
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [me.email], subject, html: out.html, headers: { "X-Entity-Ref-ID": "ct-test-" + Date.now() } })
      });
      const j = await r.json().catch(() => ({}));
      ok = r.ok;
      if (!ok) err = String(j.message || j.error || "Resend said " + r.status).slice(0, 300);
    } catch (e) { err = String(e.message || e).slice(0, 300); }
    await logSend(token, { job_id: job.id, job_name: job.name, period: out.period, kind: "test", to_count: 1, ok, error: err || null, sent_by: me.email });
    return ok ? send(res, 200, { sent: true, to: me.email, subject }) : send(res, 502, { error: "send", message: err });
  }

  return send(res, 400, { error: "action" });
};

module.exports.buildFor = buildFor;
