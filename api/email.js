// POST /api/email — admins only.
//   { action: "preview", job }  -> { subject, html, period, stats }
//   { action: "test", job }     -> sends that email to the signed-in admin only, from noreply@raghavgroup.in
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
  try { out = await buildFor(job); } catch (e) {
    console.error(e);
    return send(res, 500, { error: "build", message: "Could not build the report: " + String(e.message || e).slice(0, 200) });
  }

  if (body.action === "preview") return send(res, 200, { subject: out.subject, html: out.html, period: out.period, stats: out.stats });

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
