/* The two automatic emails, sent by /api/cron every day at 9 AM India time (only on the 1st and the 15th):
   - "monthly" on the 1st: last full month, all projects. To = Management, Cc = Site Heads, Bcc = admins.
   - "mid" on the 15th: this month so far (1st to 14th), all projects. To = Site Heads, Cc = admins.
   Recipients come from Admin → People and rights (active people only), so they follow every change of rights.
   Someone in two groups gets the email once, in the first group that names them (To, then Cc, then Bcc). */
"use strict";
const { lastFullMonth } = require("./report");

const JOBS = {
  monthly: { day: 1, name: "Automatic · monthly report (1st)" },
  mid: { day: 15, name: "Automatic · mid-month report (15th)" }
};

// India date parts for a moment
function istParts(nowMs) {
  const d = new Date((nowMs || Date.now()) + 5.5 * 36e5);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), dayNo: Math.floor(d.getTime() / 864e5) };
}

// what a job reports: monthly = last full month; mid = this month up to yesterday
function periodOf(which, nowMs) {
  const t = istParts(nowMs);
  if (which === "monthly") return { ym: lastFullMonth(nowMs), to: null };
  return { ym: t.y + "-" + (t.m < 10 ? "0" : "") + t.m, to: t.dayNo - 1 };
}

// jobs due today (India date)
function dueToday(nowMs) {
  const day = istParts(nowMs).day;
  return Object.keys(JOBS).filter((k) => JOBS[k].day === day);
}

// members: [{email, is_admin, active, auto_email}], access: [{email, project, management, site_head, control_tower}]
// auto_email false = left out of these emails (dashboard access unchanged); missing column = everyone gets them
function recipients(which, members, access) {
  const ok = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
  const live = {}; (members || []).forEach((m) => { const e = String(m.email || "").trim().toLowerCase(); if (m.active && m.auto_email !== false && ok(e)) live[e] = m; });
  const grp = (test) => Object.keys(live).filter((e) => (access || []).some((a) => String(a.email || "").toLowerCase() === e && test(a))).sort();
  const mgmt = grp((a) => a.management), site = grp((a) => a.site_head), admins = Object.keys(live).filter((e) => live[e].is_admin).sort();
  const out = which === "monthly" ? { to: mgmt, cc: site, bcc: admins } : { to: site, cc: admins, bcc: [] };
  // nobody in To: the admins get it as To so it is never lost
  if (!out.to.length) { out.to = admins; out.cc = out.cc.filter((e) => admins.indexOf(e) < 0); out.bcc = []; }
  out.cc = out.cc.filter((e) => out.to.indexOf(e) < 0);
  out.bcc = out.bcc.filter((e) => out.to.indexOf(e) < 0 && out.cc.indexOf(e) < 0);
  return out;
}

module.exports = { JOBS, istParts, periodOf, dueToday, recipients };
