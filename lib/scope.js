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
        .map(function (b) { var c = b.slice(); c[0] = b[0] >= 0 && map[b[0]] !== undefined ? map[b[0]] : -1; return c; })
    });
  }
  out.CT = (data.CT || []).filter(function (t) { return seeProj(t[4] || "All"); });
  out.ST = (data.ST || []).filter(function (t) { return seeProj(t[5] || "All"); });
  out.INV = (data.INV || []).filter(function (u) { return seeProj(u[0]); });
  out.me = {
    email: me.email, name: me.name || "", admin: !!me.admin,
    mg: R.mgAll ? "*" : Array.from(R.mg), st: R.stAll ? "*" : Array.from(R.st)
  };
  return out;
}

module.exports = { scope: scope, rights: rights };
