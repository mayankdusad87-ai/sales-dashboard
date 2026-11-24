/* Trims the cleaned dataset to what one signed-in person may see.
   access: [{project, management, site_head}] from Supabase; project "*" = all projects, including future ones.
   - rows are kept only for projects the person has any right to (walk-ins with no project / "All" only with
     management of all projects)
   - customer names are kept only for projects with Site Head rights
   - targets tagged "All" (company-wide) only with management of all projects
   Admins see everything. */
"use strict";

function rights(access, admin) {
  var mg = new Set(), st = new Set(), mgAll = !!admin, stAll = !!admin;
  (access || []).forEach(function (a) {
    if (a.project === "*") { if (a.management) mgAll = true; if (a.site_head) stAll = true; }
    else { if (a.management) mg.add(a.project); if (a.site_head) st.add(a.project); }
  });
  return { mg: mg, st: st, mgAll: mgAll, stAll: stAll };
}

function scope(data, me) {
  var R = rights(me.access, me.admin);
  var seeProj = function (p) {
    if (!p || p === "All") return R.mgAll;
    return R.mgAll || R.stAll || R.mg.has(p) || R.st.has(p);
  };
  var nameProj = function (p) { return !!p && p !== "All" && (R.stAll || R.st.has(p)); };
  var out = Object.assign({}, data);
  var pi = data.fields.indexOf("proj"), D = data.dict.proj;
  var keep = [], map = {};
  data.W.forEach(function (r, i) { if (seeProj(D[r[pi]])) { map[i] = keep.length; keep.push(i); } });
  out.W = keep.map(function (i) { return data.W[i]; });
  if (data.ID) out.ID = keep.map(function (i) { return data.ID[i]; });
  if (data.NM) out.NM = keep.map(function (i) { return nameProj(D[data.W[i][pi]]) ? data.NM[i] : ""; });
  if (data.BK) {
    out.BK = Object.assign({}, data.BK, {
      rows: data.BK.rows.filter(function (b) { return seeProj(b[1]); })
        .map(function (b) { var c = b.slice(); c[0] = b[0] >= 0 && map[b[0]] !== undefined ? map[b[0]] : -1;
          if (Array.isArray(b[15])) c[15] = b[15].map(function (i) { return map[i]; }).filter(function (i) { return i !== undefined; });
          return c; })
    });
  }
  // booking / walk-in differences: only for bookings of projects the person may see
  out.DISC = (data.DISC || []).filter(function (x) { return seeProj(x.p); });
  out.CT = (data.CT || []).filter(function (t) { return seeProj(t[4] || "All"); });
  out.ST = (data.ST || []).filter(function (t) { return seeProj(t[5] || "All"); });
  out.INV = (data.INV || []).filter(function (u) { return seeProj(u[0]); });
  // limited people also get no sheet-wide lists: dictionaries hold only values used in their own rows, and the
  // data-quality notes keep counts only (no CP firm names, Form Nos, projects or dates of other projects)
  if (!R.mgAll && !R.stAll) {
    var used = {}; data.fields.forEach(function (f, i) { if (data.dict[f]) { used[f] = {}; out.W.forEach(function (r) { used[f][r[i]] = 1; }); } });
    out.dict = {}; Object.keys(data.dict).forEach(function (f) { out.dict[f] = data.dict[f].map(function (v, i) { return used[f] && used[f][i] ? v : ""; }); });
    var q = data.Q || {}, keepQ = {};
    ["rows", "noVisitDate", "noFreshRevisit", "bookingNoDate", "cancelOnly", "headers", "dateOrder", "dateEvidence", "future", "namesBlocked"].forEach(function (k) { if (q[k] !== undefined) keepQ[k] = q[k]; });
    keepQ.cpVariants = []; keepQ.tgtCombined = {};
    if (q.bk) {
      var b = { headers: q.bk.headers, cols: q.bk.cols, avUnit: q.bk.avUnit, error: q.bk.error, rows: 0, booked: 0, cancelled: 0, linked: 0, noStatus: 0, statuses: {} };
      ((out.BK && out.BK.rows) || []).forEach(function (r) { b.rows++; if (r[3]) b.cancelled++; else b.booked++; });
      if (b.booked) b.statuses["Directly Booked"] = b.booked; if (b.cancelled) b.statuses["Cancelled at Booking"] = b.cancelled;
      keepQ.bk = b;
    }
    out.Q = keepQ;
  }
  out.me = {
    email: me.email, name: me.name || "", admin: !!me.admin,
    mg: R.mgAll ? "*" : Array.from(R.mg), st: R.stAll ? "*" : Array.from(R.st)
  };
  return out;
}

module.exports = { scope: scope, rights: rights };
