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
    var s = str(v); if (!s || s === "-" || /^(na|n\/a|nil|none|direct)$/i.test(s)) return "";
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
  // Several known projects in one cell ("Jade-Orchid-Vista") can't be split fairly: such rows count in the
  // company total only (like "All") and are listed in `combined` so they show under Data to fix.
  function targetProject(v, projMap, combined) {
    var p = project(v); if (!p) return "All";
    var known = projMap && projMap[p.toLowerCase()]; if (known) return known;
    var parts = p.split(/\s*(?:[-\/,&+]|\band\b)\s*/i).filter(Boolean);
    if (parts.length === 1 && projMap && projMap[parts[0].toLowerCase()]) return projMap[parts[0].toLowerCase()];
    if (parts.length > 1 && projMap && parts.every(function (x) { return projMap[x.toLowerCase()]; })) {
      if (combined) combined[p] = (combined[p] || 0) + 1;
      return "All";
    }
    return titleCase(p);
  }
  // Closing Targets: B manager, C project, D month, E year, F Month & Year, G monthly, H-M weeks
  function cleanClosing(rows, projMap, combined) {
    var h = findHeaderRow(rows, function (s) { return s === "month & year"; });
    var out = [];
    for (var i = h + 1; i < rows.length; i++) {
      var r = rows[i] || []; var mgr = person(r[1]); if (!mgr) continue;
      var ym = parseMonth(r[5], r[3], r[4]); if (!ym) continue;
      out.push([mgr, ym, num(r[6]), [7, 8, 9, 10, 11, 12].map(function (c) { return num(r[c]); }), targetProject(r[2], projMap, combined)]);
    }
    return out;
  }
  // Sourcing Targets: B manager, C project, F Month & Year, G bookings, H active CPs (unused), I walk-ins, J-O weeks
  function cleanSourcing(rows, projMap, combined) {
    var h = findHeaderRow(rows, function (s) { return s === "month & year"; });
    var out = [];
    for (var i = h + 1; i < rows.length; i++) {
      var r = rows[i] || []; var mgr = person(r[1]); if (!mgr) continue;
      var ym = parseMonth(r[5], r[3], r[4]); if (!ym) continue;
      out.push([mgr, ym, num(r[6]), num(r[8]), [9, 10, 11, 12, 13, 14].map(function (c) { return num(r[c]); }), targetProject(r[2], projMap, combined)]);
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

  // ---------- booking <-> walk-in: Booking details column B against Walk-in column A ----------
  // exact Form No: only capitals, spaces and punctuation are ignored, zeros are kept (INQ-02167 is not INQ-2167)
  function xkey(v) { return str(v).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function nkey(v) { return str(v).toLowerCase().replace(/^(mr|mrs|miss|ms|dr|shri|smt)\.?\s+/, "").replace(/[^a-z]/g, ""); }
  function lev(a, b) {
    var p = [], i, j; for (j = 0; j <= b.length; j++) p[j] = j;
    for (i = 1; i <= a.length; i++) { var q = [i]; for (j = 1; j <= b.length; j++) q[j] = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = q; }
    return p[b.length];
  }
  function near(a, b, share) { return !!a && !!b && (a === b || lev(a, b) <= Math.floor(Math.max(a.length, b.length) * share)); }
  function likeName(a, b) { return near(a, b, 0.3) || (Math.min(a.length, b.length) >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)); }
  // Returns match(formNo, bookingDay) -> { w, fv, why, visits }. Form Nos are reused for new customers, so:
  // the latest fresh walk-in on or before the booking says who the customer is; the first visit is the earliest
  // fresh walk-in with the same Form No AND the same name. Names are compared here only, never added to the result.
  // why: "" matched · "check" matched but the names are blank or only similar · no match: "noform", "notfound", "late", "revisit"
  function matcher(ids, rows, nms) {
    var vI = FIELDS.indexOf("vday"), kI = FIELDS.indexOf("kind"), g = {};
    ids.forEach(function (id, i) {
      var k = xkey(id), v = rows[i][vI]; if (!k || !(v > 0)) return;
      (g[k] = g[k] || []).push({ i: i, v: v, f: rows[i][kI] === 0, n: nms ? nkey(nms[i]) : "" });
    });
    for (var k in g) g[k].sort(function (a, b) { return a.v - b.v || (b.f - a.f) || a.i - b.i; });
    return function (id, bday) {
      var no = function (why) { return { w: -1, fv: -1, why: why, visits: [] }; };
      var key = xkey(id); if (!key) return no("noform");
      var all = g[key]; if (!all) return no("notfound");
      var fit = all.filter(function (x) { return x.f && x.v <= bday; });
      if (!fit.length) return no(all.some(function (x) { return x.v <= bday; }) ? "revisit" : "late");
      var last = fit[fit.length - 1], first = last, why = "";
      fit.forEach(function (x) {
        if (x === last) return;
        if (last.n && x.n === last.n) { if (first === last) first = x; }
        else if (!last.n || !x.n || likeName(x.n, last.n)) why = "check";
      });
      // this customer's own visits: matching fresh walk-ins, and the revisits that follow one of them
      var mine = false, visits = [];
      all.forEach(function (x) {
        var same = x === last || (!!last.n && x.n === last.n);
        if (x.f) mine = same;
        if (x.f ? same : (last.n && x.n ? same : mine)) visits.push(x.i);
      });
      return { w: first.i, fv: first.v, why: why, visits: visits };
    };
  }
  // Booking details against Walk-in: every entry is a thing to check; no figure depends on it
  function discrepancies(bk, rows, dict, extra) {
    var out = (extra || []).slice(), ix = {}, by = {}; FIELDS.forEach(function (f, i) { ix[f] = i; });
    function val(r, f) { return dict[f][r[ix[f]]] || ""; }
    function likePerson(a, b) {
      var x = a.split(" "), y = b.split(" ");
      if (!near(x[0], y[0], 0.4) || x[0][0] !== y[0][0]) return false;
      var s = x[x.length - 1], t = y[y.length - 1];
      return x.length < 2 || y.length < 2 || s.indexOf(t) === 0 || t.indexOf(s) === 0 || near(s, t, 0.4);
    }
    bk.forEach(function (b) {
      var add = function (t, bv, wv) { out.push({ t: t, id: b[10], row: b[13], p: b[1], bday: b[2], cx: b[3], b: bv || "", w: wv || "" }); };
      var miss = []; if (!b[1]) miss.push("Project"); if (!b[7]) miss.push("Closing manager"); if (!b[8]) miss.push("Sourcing manager");
      if (miss.length) add("blank", miss.join(", "));
      if (b[14] && b[14] !== "check") { add(b[14], b[7]); }
      var k = xkey(b[10]); if (k) (by[k] = by[k] || []).push(b);
      if (b[0] < 0) return;
      var r = rows[b[0]], src = val(r, "src"), cp = val(r, "cp"), isCp = /channel/i.test(src), wc = val(r, "cm"), wp = val(r, "proj");
      if (b[14] === "check") add("check", "", "");
      if (b[16] === "Direct" && isCp) add("cpblank", "Direct", cp || "Channel Partner");
      else if (b[16] === "Indirect" && !isCp) add("cpwalk", b[9] || "Indirect", src || "Source blank");
      else if (b[9] && cp) {
        var x = cpKey(b[9]), y = cpKey(cp);
        if (x !== y && !(Math.min(x.length, y.length) >= 5 && (x.indexOf(y) >= 0 || y.indexOf(x) >= 0)) && !near(x, y, 0.25)) add("cpdiff", b[9], cp);
      }
      if (b[7] && wc && b[7] !== wc) add(likePerson(b[7], wc) ? "cmspell" : "cm", b[7], wc);
      if (b[1] && wp && wp !== "All" && wp.toLowerCase() !== b[1].toLowerCase()) add("proj", b[1], wp);
    });
    for (var f in by) if (by[f].length > 1) by[f].forEach(function (b) {
      out.push({ t: "multi", id: b[10], row: b[13], p: b[1], bday: b[2], cx: b[3], b: by[f].length + " bookings", w: "" });
    });
    return out;
  }

  // Booking details (separate Google Sheet). Only these columns are read:
  // B Form No, V cancellation date, AD carpet area, AH agreement value (excl. GST and stamp duty), AN booking date, AS project,
  // plus "Overall Status" and the closing manager / sourcing manager / CP firm columns found by their headings.
  var BC = { form: 1, cxdate: 21, cfg: 28, carpet: 29, av: 33, bdate: 39, proj: 44 };
  // configuration actually booked (column AC): "2BHK", "2 bhk", "2.5 BHK" -> "2 BHK" / "2.5 BHK"
  function bcfg(v) {
    var s = str(v); if (!s || s === "-") return "";
    var m = /(\d+(?:\.\d+)?)\s*-?\s*bhk/i.exec(s); if (m) return m[1] + " BHK";
    if (/jodi/i.test(s)) return "Jodi"; if (/\brk\b/i.test(s)) return "1 RK"; if (/shop|office|commercial/i.test(s)) return "Commercial";
    return s.slice(0, 20);
  }
  var BHEAD = {
    form: [/form|enq|inq|lead|id|no/, "Form No"], cxdate: [/cancel/, "Cancellation Date"], carpet: [/carpet/, "Carpet Area"],
    av: [/agreement|value|\bav\b/, "Agreement Value"], bdate: [/book/, "Booking Date"], proj: [/project/, "Project Name"],
    cfg: [/config|type|bhk|unit/, "Configuration"]
  };
  function cleanBookings(rows, Q, match, projMap, issues) {
    var B = Q.bk = { rows: 0, booked: 0, cancelled: 0, linked: 0, noStatus: 0, statuses: {}, headers: { found: false, bad: [] }, avUnit: "rupees", noValue: 0, noCarpet: 0 };
    var h = findHeaderRow(rows, function (s) { return s.indexOf("overall status") >= 0; });
    if (h < 0) { B.error = "No “Overall Status” heading found in the first 10 rows"; return []; }
    var hr = (rows[h] || []).map(function (c) { return str(c).toLowerCase(); });
    B.headers.found = true;
    Object.keys(BHEAD).forEach(function (k) { var got = hr[BC[k]] || ""; if (!BHEAD[k][0].test(got)) B.headers.bad.push({ col: colName(BC[k]), want: BHEAD[k][1], got: rows[h][BC[k]] ? str(rows[h][BC[k]]) : "" }); });
    function find(re, not) { for (var i = 0; i < hr.length; i++) if (re.test(hr[i]) && !(not && not.test(hr[i]))) return i; return -1; }
    var cSt = find(/overall status/), cCm = find(/closing/, /date|target/), cSm = find(/sourcing/, /date|target/),
      cCp = find(/(channel partner|cp).*(company|firm)|(company|firm).*(channel partner|cp)/), cSrc = find(/source\s*type/);
    if (cSrc < 0) B.headers.bad.push({ col: "Q", want: "Source Type", got: rows[h][16] ? str(rows[h][16]) : "" });
    B.cols = { status: colName(cSt), closing: cCm < 0 ? "" : colName(cCm), sourcing: cSm < 0 ? "" : colName(cSm), cpFirm: cCp < 0 ? "" : colName(cCp), source: cSrc < 0 ? "" : colName(cSrc) };
    var st0 = h + 1, oB = detectOrder(rows, BC.bdate, st0, "dmy").order, oC = detectOrder(rows, BC.cxdate, st0, "dmy").order;
    // agreement value unit (rupees, lakhs or crores): pick the one that gives a believable ₹ per sq ft;
    // without carpet areas, fall back to the size of the typical value
    var avs = [], per = [];
    for (var i = st0; i < rows.length; i++) { var rr = rows[i] || [], a = num(rr[BC.av]), ca = num(rr[BC.carpet]); if (a > 0) { avs.push(a); if (ca > 0) per.push(a / ca); } }
    var mid = function (x) { x.sort(function (p, q) { return p - q; }); return x.length ? x[x.length >> 1] : 0; };
    var med = mid(avs), mp = mid(per), mult = 1;
    if (mp) mult = [1, 1e5, 1e7].filter(function (m) { return mp * m >= 2000 && mp * m <= 100000; })[0] || 1;
    else mult = med && med < 20 ? 1e7 : med && med < 100000 ? 1e5 : 1;
    B.avUnit = mult === 1e7 ? "crores" : mult === 1e5 ? "lakhs" : "rupees";
    var out = [], cmMap = {}, cpMap = {}, cpSeen = {}, dupSeen = {};
    for (i = st0; i < rows.length; i++) {
      var r = rows[i] || [], bdRaw = str(r[BC.bdate]), status = str(r[cSt]);
      if (!bdRaw && !status && !str(r[BC.form])) continue;
      B.rows++;
      var id = str(r[BC.form]).slice(0, 24), p = project(r[BC.proj]), pn = p ? ((projMap && projMap[p.toLowerCase()]) || titleCase(p)) : "", bday = -1, cx = 0;
      var issue = function (t, bv) { issues.push({ t: t, id: id, row: i + 1, p: pn, bday: bday, cx: cx, b: bv || "", w: "" }); };
      cx = /cancel/i.test(status) ? 1 : 0;
      // booked = booking date AND overall status; rows left out are reported, never dropped silently
      if (!bdRaw || !status) { if (bdRaw) { B.noStatus++; issue("nostatus"); } else if (status) { B.noDate = (B.noDate || 0) + 1; issue("nodate", "blank"); } continue; }
      var bd0 = parseDate(r[BC.bdate], oB); if (bd0 === null) { B.noDate = (B.noDate || 0) + 1; issue("nodate", "cannot be read"); continue; }
      bday = bd0;
      B.statuses[status] = (B.statuses[status] || 0) + 1;
      var cday = cx ? parseDate(r[BC.cxdate], oC) : null;
      if (!/^(directly booked|cancelled at booking)$/i.test(status)) issue("status", status.slice(0, 40));
      if (cx && cday === null) { issue("cxnodate"); cday = bday; }
      // a cancellation cannot come before its booking: count it in the booking's month and report the row
      if (cx && cday < bday) { B.cxBeforeBk = B.cxBeforeBk || []; if (B.cxBeforeBk.length < 30) B.cxBeforeBk.push({ id: id, row: i + 1 }); issue("cxbefore"); cday = bday; }
      var av = num(r[BC.av]) * mult, carpet = num(r[BC.carpet]);
      if (!(av > 0)) B.noValue++; if (!(carpet > 0)) B.noCarpet++;
      // channel: column Q (Source Type) decides; column R only names the CP firm of an Indirect booking
      var sRaw = cSrc < 0 ? "" : str(r[cSrc]), chan = /^direct$/i.test(sRaw) ? "Direct" : /^indirect$/i.test(sRaw) ? "Indirect" : "", firm = cCp < 0 ? "" : canonCP(cpMap, cpSeen, r[cCp]);
      var L = match(id, bday);
      var entry = [L.w, pn, bday, cx, cx ? cday : -1, Math.round(av), Math.round(carpet * 100) / 100,
        cCm < 0 ? "" : person(r[cCm]), cSm < 0 ? "" : person(r[cSm]), chan === "Indirect" ? firm : "", id, L.fv, bcfg(r[BC.cfg]), i + 1, L.why, L.visits, chan];
      // the same Form No booked again on the same date: a row with no value and no carpet is counted once (the
      // fuller row wins); two full rows are both kept (two flats). Either way the sheet rows are reported.
      var dk = xkey(id) ? xkey(id) + "|" + bday + "|" + cx : "", blank = !(av > 0) && !(carpet > 0);
      if (dk && dupSeen[dk]) {
        var s0 = dupSeen[dk], drop = blank ? i + 1 : s0.blank ? s0.row : 0;
        issue("dup", "rows " + s0.row + " and " + (i + 1) + (drop ? "; row " + drop + " has no value or carpet area and is not counted" : "; both have a value, so both are counted"));
        if (blank) continue;
        if (s0.blank) { out[s0.idx] = entry; s0.blank = false; s0.row = i + 1; continue; }
      }
      if (dk && !dupSeen[dk]) dupSeen[dk] = { idx: out.length, row: i + 1, blank: blank };
      if (chan === "Indirect" && !firm) issue("cpmissing");
      if (chan === "Direct" && firm) issue("dirfirm", firm);
      if (!chan) issue("srcbad", sRaw ? sRaw.slice(0, 30) : "blank");
      if (cx) B.cancelled++; else B.booked++;
      if (L.w >= 0) B.linked++;
      out.push(entry);
      // how column AC is written (configuration text, not personal), so the reading can be checked
      var rawC = str(r[BC.cfg]).slice(0, 30); if (rawC) { B.cfgRaw = B.cfgRaw || {}; if (B.cfgRaw[rawC] || Object.keys(B.cfgRaw).length < 25) B.cfgRaw[rawC] = (B.cfgRaw[rawC] || 0) + 1; }
    }
    return out;
  }

  // share (%) of each month's fresh walk-ins with no project: a percentage only, so people limited to one project
  // are also told when walk-ins cannot be judged by project
  function untagged(rows, dict) {
    var kI = FIELDS.indexOf("kind"), vI = FIELDS.indexOf("vday"), pI = FIELDS.indexOf("proj"), m = {}, out = {};
    rows.forEach(function (r) {
      if (r[kI] !== 0 || !(r[vI] > 0)) return;
      var d = new Date(r[vI] * 864e5), k = d.getUTCFullYear() * 100 + d.getUTCMonth() + 1, p = dict.proj[r[pI]];
      var o = m[k] || (m[k] = { n: 0, u: 0 }); o.n++; if (!p || p === "All") o.u++;
    });
    for (var k in m) out[k] = Math.round(m[k].u / m[k].n * 1000) / 10;
    return out;
  }

  function cleanAll(tabs, meta) {
    var Q = { rows: 0, noVisitDate: 0, noFreshRevisit: 0, bookingNoDate: 0, cancelOnly: 0 };
    var w = cleanWalkins(tabs.walkin || [], Q, !!(meta && meta.names));
    var BK = null, DISC = [];
    if (tabs.bookings) {
      var bkRows = cleanBookings(tabs.bookings, Q, matcher(w.ids, w.rows, w.nms), w.projMap, DISC);
      BK = { fields: ["w", "proj", "bday", "cx", "cday", "av", "carpet", "cm", "sm", "cp", "id", "fv", "cfg", "row", "why", "visits", "chan"], rows: bkRows };
      DISC = discrepancies(bkRows, w.rows, w.dict, DISC);
    }
    return {
      BK: BK,
      DISC: DISC,
      UNT: untagged(w.rows, w.dict),
      ID: w.ids,
      NM: w.nms,
      v: 1,
      asOf: (meta && meta.asOf) || new Date().toISOString(),
      file: (meta && meta.file) || "All Data.xlsx",
      fields: FIELDS,
      dict: w.dict,
      W: w.rows,
      CT: cleanClosing(tabs.closing || [], w.projMap, Q.tgtCombined = {}),
      ST: cleanSourcing(tabs.sourcing || [], w.projMap, Q.tgtCombined),
      INV: cleanInventory(tabs.inventory || [], w.projMap),
      Q: Q
    };
  }

  var api = { cleanAll: cleanAll, matcher: matcher, discrepancies: discrepancies, parseDate: parseDate, TABS: { walkin: "Walk-in", closing: "Closing Targets", sourcing: "Sourcing Targets", inventory: "Inventory Status" } };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SalesClean = api;
})(typeof self !== "undefined" ? self : this);
