/* Cleans the four sheet tabs into the compact dataset the dashboard reads.
   Input: each tab as an array of rows (arrays of cell values: string, number or Date).
   Personal data columns are never read. Works in Node (Vercel) and in the browser. */
(function (root) {
  "use strict";

  // ---- settings ----
  var NAME_ALIASES = {
    "SHARON": "SHARON BARSE",
    "TEJAS ANGARKHE": "TEJAS ANGARAKHE",
    "RISHAB SHAW": "RISHABH SHAW",
    "SIDDHESH": "SIDDHESH VASAIKAR"
  };
  var PROJECT_ALIASES = { "anantha": "Ananta" };

  // Walk-in columns by letter (A = 0). Personal columns (F-H, Q, AB-AC, AG-AH, AO) are deliberately absent.
  // Customer name (E) is read only when the caller asks for it (the API does so only when DASHBOARD_PASSWORD is set).
  var FORM_COL = 0, NAME_COL = 4;
  // What each used column's heading should look like; a mismatch means a column was added, removed or moved.
  var HEAD = {
    form: [/form|enq|inq|lead|sr|id|no/, "Form No"], proj: [/project/, "Project Name"], vdate: [/visit/, "Date of Visit"],
    src: [/^source(?!.*fund)/, "Source"], cp: [/channel|partner|cp/, "Channel Partner Company"], sm: [/sourcing/, "Sourcing Manager"],
    cm: [/closing/, "Closing Manager"], tin: [/time.*in|in.*time/, "Time In"], tattend: [/attend/, "Time Attended"], aff: [/affinity/, "Customer Affinity"],
    lost: [/lost/, "Reason for Lost"], bkdone: [/booking.*done|done/, "Booking Done"], bkdate: [/booking.*date/, "Booking Date"],
    cxl: [/cancel/, "Booking Cancellation"], cxdate: [/cancel.*date|date.*cancel/, "Cancellation Date"], aw: [/fresh|revisit/, "Customer Fresh/Revisit"]
  };
  function colName(i) { var s = ""; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  var C = {
    proj: 1, vdate: 2, age: 9, gender: 10, eth: 11, acc: 12, emp: 13, city: 14, loc: 15,
    cfg: 19, budget: 20, area: 21, cons: 22, purpose: 23, fund: 24, src: 25, cp: 26,
    sm: 34, cm: 35, tin: 36, tattend: 37, aff: 38, lost: 41, bkvisit: 42, bkdone: 43,
    bktype: 44, bkdate: 45, cxl: 46, cxdate: 47, aw: 48
  };
  var DIMS = ["proj", "src", "cp", "sm", "cm", "aff", "lost", "age", "gender", "eth", "acc", "emp", "city", "loc",
    "cfg", "budget", "area", "cons", "purpose", "fund", "bkvisit", "bktype", "awv"];
  var FIELDS = DIMS.concat(["kind", "vday", "bk", "bday", "cx", "cday", "wait"]);

  var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

  function str(v) {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toISOString();
    return String(v).replace(/[​ ]/g, " ").replace(/\s+/g, " ").trim();
  }
  function yes(v) { return /^(y|yes)$/i.test(str(v)); }
  function dayOf(y, m, d) {
    if (y < 100) y += 2000;
    if (y < 2015 || y > 2035 || m < 0 || m > 11 || d < 1 || d > 31) return null;
    return Math.floor(Date.UTC(y, m, d) / 864e5);
  }
  // order: "mdy" or "dmy" for ambiguous numeric strings
  function parseDate(v, order) {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null;
      var local = v.getTime() - v.getTimezoneOffset() * 6e4 + 12 * 36e5;
      var dd = new Date(local);
      return dayOf(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate());
    }
    if (typeof v === "number") {
      if (v < 30000 || v > 60000) return null;
      return Math.floor(v + 1e-6) - 25569;
    }
    var s = str(v), m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return dayOf(+m[1], +m[2] - 1, +m[3]);
    if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s))) {
      var a = +m[1], b = +m[2], y = +m[3];
      var mdy = order === "mdy";
      if (a > 12) mdy = false; else if (b > 12) mdy = true;
      return mdy ? dayOf(y, a - 1, b) : dayOf(y, b - 1, a);
    }
    if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-]*([A-Za-z]{3,})[\s,\-]*(\d{2,4})/.exec(s)) && MON[m[2].slice(0, 3).toLowerCase()] !== undefined)
      return dayOf(+m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1]);
    if ((m = /^([A-Za-z]{3,})[\s\-]*(\d{1,2}),?[\s\-]*(\d{4})/.exec(s)) && MON[m[1].slice(0, 3).toLowerCase()] !== undefined)
      return dayOf(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]);
    return null;
  }
  function parseMinutes(v) {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
    if (typeof v === "number") { var f = v % 1; return Math.round(f * 1440); }
    // accepts "11:30", "11:30:00 AM", "11.30 am", "11:30AM", "11 AM", "1130", and a date followed by a time
    var s = str(v), m = /(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*[:.]\s*\d{2})?\s*([AaPp]\.?\s*[Mm]\.?)?/.exec(s) ||
      /^(\d{1,2})()\s*([AaPp]\.?\s*[Mm]\.?)$/.exec(s) || /^(\d{1,2})(\d{2})$/.exec(s);
    if (!m) return null;
    var h = +m[1], mi = m[2] === "" ? 0 : +m[2];
    if (h > 23 || mi > 59) return null;
    if (m[3]) { h = h % 12; if (/p/i.test(m[3])) h += 12; }
    return h * 60 + mi;
  }
  function parseMonth(v, mon, yr) { // returns "YYYY-MM"
    var m, y, mi;
    if (v instanceof Date && !isNaN(v.getTime())) { y = v.getFullYear(); mi = v.getMonth(); }
    else if (typeof v === "number" && v > 30000) { var d = new Date((Math.floor(v) - 25569) * 864e5); y = d.getUTCFullYear(); mi = d.getUTCMonth(); }
    else {
      var s = str(v);
      if ((m = /^([A-Za-z]{3,})[\s\-',]*(\d{2,4})$/.exec(s)) && MON[m[1].slice(0, 3).toLowerCase()] !== undefined) { mi = MON[m[1].slice(0, 3).toLowerCase()]; y = +m[2]; }
      else if (mon && MON[str(mon).slice(0, 3).toLowerCase()] !== undefined && +str(yr)) { mi = MON[str(mon).slice(0, 3).toLowerCase()]; y = +str(yr); }
      else return null;
    }
    if (y < 100) y += 2000;
    return y + "-" + (mi < 9 ? "0" : "") + (mi + 1);
  }
  function num(v) { var n = +str(v).replace(/,/g, ""); return isFinite(n) ? n : 0; }

  // CP firm names: "Square Yards", "SquareYards", "Square Yards Pvt. Ltd." count as one firm; the other spellings are reported
  function cpKey(s) { return s.toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|the)\b/g, "").replace(/[^a-z0-9]/g, ""); }
  function canonCP(map, seen, v) {
    var s = str(v); if (!s || s === "-" || /^(na|n\/a|nil|none)$/i.test(s)) return "";
    var k = cpKey(s); if (!k) return "";
    if (!map[k]) map[k] = s;
    var first = map[k]; if (s !== first) { var o = seen[first] || (seen[first] = {}); o[s] = (o[s] || 0) + 1; }
    return first;
  }
  function canon(map, v) { // merge case/spacing variants, keep first spelling seen
    var s = str(v); if (!s) return "";
    var k = s.toLowerCase();
    if (!map[k]) map[k] = s;
    return map[k];
  }
  function person(v) {
    var s = str(v).toUpperCase().replace(/^(MR|MRS|MISS|MS|DR)\.?\s+/, "").trim();
    if (s === "-" || s === "NA" || s === "N/A") s = "";
    return NAME_ALIASES[s] || s;
  }
  function project(v) {
    var s = str(v).replace(/^raghav\s+/i, "");
    return PROJECT_ALIASES[s.toLowerCase()] || s;
  }
  function source(v) {
    var s = str(v);
    if (/^walk[\s\-]*in$/i.test(s)) return "Walk-in";
    return s;
  }
  function affinity(v) {
    var s = str(v).toLowerCase();
    if (!s) return "";
    if (s.indexOf("lost") === 0) return "Lost";
    if (s === "hot") return "Hot";
    if (s.replace(/\s/g, "") === "warmhigh") return "Warm High";
    if (s.replace(/\s/g, "") === "warmlow") return "Warm Low";
    if (s === "cold") return "Cold";
    return str(v);
  }

  // Decide day/month order for a date column from its own unambiguous text dates
  // (e.g. "20-10-2026" proves day-first, "10/20/2026" proves month-first). Real date cells are not affected.
  function detectOrder(rows, col, start, fallback) {
    var d = 0, m = 0, amb = 0, dR = [], mR = [];
    for (var i = start; i < rows.length; i++) {
      var v = (rows[i] || [])[col];
      if (typeof v !== "string") continue;
      var x = /^\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.]\d{2,4}/.exec(v);
      if (!x) continue;
      if (+x[1] > 12) { d++; if (dR.length < 12) dR.push(i + 1); }
      else if (+x[2] > 12) { m++; if (mR.length < 12) mR.push(i + 1); }
      else amb++;
    }
    return { order: d > m ? "dmy" : m > d ? "mdy" : fallback, dayFirst: d, monthFirst: m, either: amb, dayFirstRows: dR, monthFirstRows: mR };
  }

  // Read-only count of how Date of Visit (column C) is stored, to choose the right day/month order.
  function dateDiag(Q, v, rowNo, proj) {
    var D = Q.dateDiag || (Q.dateDiag = { realDate: 0, number: 0, text: 0, empty: 0, shapes: {}, tail: [] });
    var raw;
    if (v === null || v === undefined || v === "") { D.empty++; raw = "empty"; }
    else if (v instanceof Date) { D.realDate++; raw = "date " + (isNaN(v.getTime()) ? "invalid" : v.toISOString().slice(0, 10)); }
    else if (typeof v === "number") { D.number++; raw = "number " + v; }
    else {
      D.text++; var s = str(v); raw = "text \"" + s + "\"";
      var m = /^(\d{1,2})([\/\-.])(\d{1,2})\2(\d{2,4})/.exec(s);
      var key = m ? (m[1].length === 2 ? "NN" : "N") + m[2] + (m[3].length === 2 ? "NN" : "N") + m[2] + "Y" + m[4].length : "other";
      var c = D.shapes[key] || (D.shapes[key] = { n: 0, firstOver12: 0, secondOver12: 0, ambiguous: 0 });
      c.n++;
      if (m) { if (+m[1] > 12) c.firstOver12++; else if (+m[3] > 12) c.secondOver12++; else c.ambiguous++; }
    }
    D.tail.push({ row: rowNo, project: proj, C: raw });
    if (D.tail.length > 15) D.tail.shift();
  }

  // read-only count of how Time In / Time Attended are stored (times are not personal data)
  function timeDiag(Q, v, parsed) {
    var T = Q.timeDiag || (Q.timeDiag = { empty: 0, read: 0, unread: 0, samples: [] });
    if (v === null || v === undefined || v === "") { T.empty++; return; }
    if (parsed !== null) { T.read++; return; }
    T.unread++;
    // only the shape of the value is kept (never the value: these cells sometimes hold names)
    var t = str(v), s = v instanceof Date ? "date" : typeof v === "number" ? "number" : /[a-z]/i.test(t) ? "text with letters" : "text " + t.replace(/\d/g, "9").slice(0, 12);
    if (T.samples.length < 8 && T.samples.indexOf(s) < 0) T.samples.push(s);
  }
  function cleanWalkins(rows, Q, names) {
    var dict = {}, idx = {}, canonMaps = {}, cpMap = {}, cpSeen = {}, ids = [], nms = [];
    DIMS.forEach(function (d) { dict[d] = [""]; idx[d] = { "": 0 }; canonMaps[d] = {}; });
    function code(d, v) {
      if (!(v in idx[d])) { idx[d][v] = dict[d].length; dict[d].push(v); }
      return idx[d][v];
    }
    var out = [];
    var h = findHeaderRow(rows, function (s) { return s.indexOf("date of visit") === 0; });
    var st0 = h < 0 ? 1 : h + 1;
    // heading check: report every used column whose heading does not look like what we expect
    Q.headers = { found: h >= 0, bad: [] };
    if (h >= 0) {
      var hr = rows[h] || [];
      Object.keys(HEAD).forEach(function (k) {
        var col = k === "form" ? FORM_COL : C[k], got = str(hr[col]);
        if (!HEAD[k][0].test(got.toLowerCase())) Q.headers.bad.push({ col: colName(col), want: HEAD[k][1], got: got });
      });
      // names only when column E really is the customer name (never a phone, email or anything else after a column move)
      var nh = str(hr[NAME_COL]).toLowerCase();
      if (names && !(/name/.test(nh) && !/mobile|phone|email|cp|partner|manager|project/.test(nh))) { names = false; Q.namesBlocked = str(hr[NAME_COL]) || "(blank)"; }
    } else names = false;
    var eV = detectOrder(rows, C.vdate, st0, "mdy"), eB = detectOrder(rows, C.bkdate, st0, "dmy"), eC = detectOrder(rows, C.cxdate, st0, "dmy");
    var oV = eV.order, oB = eB.order, oC = eC.order;
    Q.dateOrder = { visit: oV, booking: oB, cancellation: oC };
    Q.dateEvidence = { visit: eV, booking: eB, cancellation: eC };
    // dates after today (India time) are impossible for a visit, booking or cancellation
    var todayIN = Math.floor((Date.now() + 5.5 * 36e5) / 864e5);
    Q.future = { visit: { n: 0, rows: [] }, booking: { n: 0, rows: [] }, cancellation: { n: 0, rows: [] } };
    function fut(k, d, rowNo) { if (d !== null && d > todayIN) { var f = Q.future[k]; f.n++; if (f.rows.length < 15) f.rows.push(rowNo); } }
    for (var i = st0; i < rows.length; i++) {
      var r = rows[i]; if (!r) continue;
      var vday = parseDate(r[C.vdate], oV);
      var projV = project(r[C.proj]);
      var awRaw = str(r[C.aw]);
      if (vday === null && !projV && !awRaw && !str(r[C.cm])) continue; // empty line
      Q.rows++;
      if (vday === null) Q.noVisitDate++;
      dateDiag(Q, r[C.vdate], i + 1, projV);
      var awl = awRaw.toLowerCase();
      var kind = awl === "fresh" ? 0 : (awl.indexOf("revisit") >= 0 ? 1 : 2);
      if (kind === 2) Q.noFreshRevisit++;
      var bdRaw = str(r[C.bkdate]);
      var bday = parseDate(r[C.bkdate], oB);
      var cx = yes(r[C.cxl]) ? 1 : 0;
      var bk = (bdRaw || yes(r[C.bkdone]) || cx) ? 1 : 0;
      if (bk && bday === null) { Q.bookingNoDate++; bday = vday; }
      if (bk && !yes(r[C.bkdone]) && !bdRaw && cx) Q.cancelOnly++;
      var cday = cx ? parseDate(r[C.cxdate], oC) : null;
      if (cx && cday === null) cday = bday;
      fut("visit", vday, i + 1);
      if (bk && str(r[C.bkdate])) fut("booking", bday, i + 1);
      if (cx && str(r[C.cxdate])) fut("cancellation", cday, i + 1);
      var t1 = parseMinutes(r[C.tin]), t2 = parseMinutes(r[C.tattend]);
      // 12-hour times written without AM/PM ("12:50" -> "1:10") are read as crossing noon
      var d12 = t1 !== null && t2 !== null && t2 < t1 && t2 + 720 - t1 <= 180 ? t2 + 720 - t1 : null;
      var wait = (t1 !== null && t2 !== null && t2 >= t1 && t2 - t1 <= 600) ? t2 - t1 : d12 !== null ? d12 : -1;
      timeDiag(Q, r[C.tin], t1); timeDiag(Q, r[C.tattend], t2);
      var vals = {
        proj: projV, src: source(r[C.src]), cp: canonCP(cpMap, cpSeen, r[C.cp]), sm: person(r[C.sm]), cm: person(r[C.cm]),
        aff: affinity(r[C.aff]), lost: canon(canonMaps.lost, r[C.lost]), age: canon(canonMaps.age, r[C.age]),
        gender: canon(canonMaps.gender, r[C.gender]), eth: canon(canonMaps.eth, r[C.eth]), acc: canon(canonMaps.acc, r[C.acc]),
        emp: canon(canonMaps.emp, r[C.emp]), city: canon(canonMaps.city, r[C.city]), loc: canon(canonMaps.loc, r[C.loc]),
        cfg: canon(canonMaps.cfg, r[C.cfg]), budget: canon(canonMaps.budget, r[C.budget]), area: canon(canonMaps.area, r[C.area]),
        cons: canon(canonMaps.cons, r[C.cons]), purpose: canon(canonMaps.purpose, r[C.purpose]), fund: canon(canonMaps.fund, r[C.fund]),
        bkvisit: canon(canonMaps.bkvisit, r[C.bkvisit]), bktype: canon(canonMaps.bktype, r[C.bktype]), awv: canon(canonMaps.awv, awRaw)
      };
      vals.proj = canon(canonMaps.proj, vals.proj);
      vals.src = canon(canonMaps.src, vals.src);
      var row = DIMS.map(function (d) { return code(d, vals[d]); });
      row.push(kind, vday === null ? -1 : vday, bk, bk ? (bday === null ? -1 : bday) : -1, cx, cx ? (cday === null ? -1 : cday) : -1, wait);
      out.push(row);
      ids.push(str(r[FORM_COL]).slice(0, 24));
      if (names) nms.push(str(r[NAME_COL]).slice(0, 60));
    }
    // other spellings merged into each CP firm, biggest first (shown under Data to fix)
    Q.cpVariants = Object.keys(cpSeen).map(function (f) {
      var o = cpSeen[f], n = 0; for (var s in o) n += o[s];
      return { firm: f, n: n, as: Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, 4) };
    }).sort(function (a, b) { return b.n - a.n; }).slice(0, 40);
    return { dict: dict, rows: out, projMap: canonMaps.proj, ids: ids, nms: names ? nms : null };
  }

  function findHeaderRow(rows, test) {
    for (var i = 0; i < Math.min(rows.length, 10); i++) if ((rows[i] || []).some(function (c) { return test(str(c).toLowerCase()); })) return i;
    return -1;
  }

  // Project Name (column C) of a target row, spelled like the Walk-in tab ("ANANTA" -> "Ananta"); blank -> "All"
  function targetProject(v, projMap) {
    var p = project(v); if (!p) return "All";
    return (projMap && projMap[p.toLowerCase()]) || titleCase(p);
  }
  // Closing Targets: B manager, C project, D month, E year, F Month & Year, G monthly, H-M weeks
  function cleanClosing(rows, projMap) {
    var h = findHeaderRow(rows, function (s) { return s === "month & year"; });
    var out = [];
    for (var i = h + 1; i < rows.length; i++) {
      var r = rows[i] || []; var mgr = person(r[1]); if (!mgr) continue;
      var ym = parseMonth(r[5], r[3], r[4]); if (!ym) continue;
      out.push([mgr, ym, num(r[6]), [7, 8, 9, 10, 11, 12].map(function (c) { return num(r[c]); }), targetProject(r[2], projMap)]);
    }
    return out;
  }
  // Sourcing Targets: B manager, C project, F Month & Year, G bookings, H active CPs (unused), I walk-ins, J-O weeks
  function cleanSourcing(rows, projMap) {
    var h = findHeaderRow(rows, function (s) { return s === "month & year"; });
    var out = [];
    for (var i = h + 1; i < rows.length; i++) {
      var r = rows[i] || []; var mgr = person(r[1]); if (!mgr) continue;
      var ym = parseMonth(r[5], r[3], r[4]); if (!ym) continue;
      out.push([mgr, ym, num(r[6]), num(r[8]), [9, 10, 11, 12, 13, 14].map(function (c) { return num(r[c]); }), targetProject(r[2], projMap)]);
    }
    return out;
  }
  // Inventory Status: located by header names
  // Inventory spells projects in capitals ("ANANTA"); use the Walk-in spelling ("Ananta") so filters match.
  function titleCase(s) { return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s\-\/])([a-z])/g, function (x, a, b) { return a + b.toUpperCase(); }) : s; }
  function cleanInventory(rows, projMap) {
    projMap = projMap || {};
    var h = findHeaderRow(rows, function (s) { return s === "unit status"; });
    if (h < 0) return [];
    var hdr = rows[h].map(function (c) { return str(c).toLowerCase(); });
    function col(re, d) { for (var i = 0; i < hdr.length; i++) if (re.test(hdr[i])) return i; return d; }
    var cP = col(/^project/, 1), cU = col(/unit name/, 2), cF = col(/sub type/, 3), cS = col(/unit status/, 4), cA = col(/area/, 5), cT = col(/type$/, 6);
    if (cT === cF) cT = 6;
    var out = [], pm = {};
    for (var i = h + 1; i < rows.length; i++) {
      var r = rows[i] || []; var p = project(r[cP]); var st = str(r[cS]); if (!p || !st) continue;
      var s = st.toLowerCase();
      var grp = s === "available" ? "Unsold" : (s === "reserved" || s === "blocked") ? "On hold" : "Sold";
      var t = str(r[cT]); if (!t || t === "-") t = "Not set"; if (t === "2") t = "2 BHK";
      out.push([projMap[p.toLowerCase()] || canon(pm, titleCase(p)), str(r[cU]), str(r[cF]), grp, st, num(r[cA]), t]);
    }
    return out;
  }

  function cleanAll(tabs, meta) {
    var Q = { rows: 0, noVisitDate: 0, noFreshRevisit: 0, bookingNoDate: 0, cancelOnly: 0 };
    var w = cleanWalkins(tabs.walkin || [], Q, !!(meta && meta.names));
    return {
      ID: w.ids,
      NM: w.nms,
      v: 1,
      asOf: (meta && meta.asOf) || new Date().toISOString(),
      file: (meta && meta.file) || "All Data.xlsx",
      fields: FIELDS,
      dict: w.dict,
      W: w.rows,
      CT: cleanClosing(tabs.closing || [], w.projMap),
      ST: cleanSourcing(tabs.sourcing || [], w.projMap),
      INV: cleanInventory(tabs.inventory || [], w.projMap),
      Q: Q
    };
  }

  var api = { cleanAll: cleanAll, parseDate: parseDate, TABS: { walkin: "Walk-in", closing: "Closing Targets", sourcing: "Sourcing Targets", inventory: "Inventory Status" } };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SalesClean = api;
})(typeof self !== "undefined" ? self : this);
