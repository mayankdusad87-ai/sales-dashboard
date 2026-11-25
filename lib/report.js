/* Builds the monthly management email from the cleaned dataset (same rules as the dashboard).
   build(data, { ym:"2026-10", projects:["*"] | ["Jade",...], sections:{decisions,cards,channel,realisation}, url })
   -> { subject, html, preheader, period, stats }
   Layout: headline in money, 4 numbers with comparisons, decisions (issue, ₹ impact, action, owner) beside the
   six-month trend and win of the month, one row per project, channel and cancellations, data confidence.
   Full width on a laptop, one column on a phone. Section keys: cards = trend and win of the month.
   Works in Node (api/email.js) and in the browser (Admin preview). */
(function (root) {
  "use strict";
  var BRK = 0.0225;
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function dayOf(y, m, d) { return Math.floor(Date.UTC(y, m, d) / 864e5); }
  function range(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1; return { from: dayOf(y, m, 1), to: dayOf(y, m + 1, 0), y: y, m: m }; }
  function ymAdd(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + "-" + (m < 9 ? "0" : "") + (m + 1); }
  function lastFullMonth(nowMs) { var d = new Date((nowMs || Date.now()) + 5.5 * 36e5); return ymAdd(d.getUTCFullYear() + "-" + (d.getUTCMonth() < 9 ? "0" : "") + (d.getUTCMonth() + 1), -1); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmt(n) { return Math.round(n).toLocaleString("en-IN"); }
  function sgn(n) { return n < 0 ? "−" + fmt(-n) : fmt(n); }
  function fcr(v) { if (!v) return "–"; var a = Math.abs(v); return a >= 1e7 ? "₹" + (a / 1e7).toFixed(a >= 1e9 ? 0 : a >= 1e8 ? 1 : 2).replace(/\.?0+$/, "") + " Cr" : "₹" + Math.round(a / 1e5) + " L"; }
  function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; }
  function dl(day) { var d = new Date(day * 864e5); return d.getUTCDate() + " " + MON[d.getUTCMonth()] + " " + String(d.getUTCFullYear()).slice(2); }

  function build(data, opt) {
    opt = opt || {};
    var ym = opt.ym || lastFullMonth(opt.now), R = range(ym), sec = Object.assign({ decisions: true, cards: true, channel: true, realisation: true }, opt.sections || {});
    var F = data.fields, D = data.dict, ix = {}; F.forEach(function (k, i) { ix[k] = i; });
    var P = function (r) { return D.proj[r[ix.proj]] || ""; }, SRC = function (r) { return D.src[r[ix.src]] || ""; };
    var all = !opt.projects || opt.projects.indexOf("*") >= 0, want = {};
    (opt.projects || []).forEach(function (p) { want[p] = 1; });
    var inScope = function (p) { return all ? true : !!want[p]; };
    var real = function (p) { return p && p !== "All"; };
    var M = MONL[R.m], Ms = MON[R.m], NEXT = MONL[(R.m + 1) % 12];

    // bookings: Booking details when present, else the Walk-in sheet's own booking columns
    var BKS = [];
    if (data.BK && data.BK.rows && data.BK.rows.length) {
      data.BK.rows.forEach(function (b) {
        var ch = b[16] || "", cp = ch === "Indirect"; // Booking details column Q (Source Type)
        BKS.push({ p: b[1], bday: b[2], cx: b[3], cday: b[4], av: b[5], ca: b[6], cp: cp, dir: ch === "Direct", cfg: b.length > 12 ? b[12] || "" : "", cm: b[7], firm: b[9] });
      });
    } else {
      data.W.forEach(function (r) { if (r[ix.bk]) BKS.push({ p: P(r), bday: r[ix.bday], cx: r[ix.cx], cday: r[ix.cday], av: 0, ca: 0, cp: /channel/i.test(SRC(r)), dir: !/channel/i.test(SRC(r)), cfg: "" }); });
    }
    // a booking whose ₹/sq ft is more than 40% from its project's median is a typing error: kept out of ₹/sq ft
    var rates = {}; BKS.forEach(function (b) { if (!b.cx && b.av > 0 && b.ca > 0 && b.p) (rates[b.p] = rates[b.p] || []).push(b.av / b.ca); });
    var med = {}; for (var k in rates) if (rates[k].length >= 5) med[k] = median(rates[k]);
    var okRate = function (b) { var m = med[b.p]; if (!m) return true; var x = b.av / b.ca / m; return x >= 0.6 && x <= 1.6; };

    function blank() { return { fresh: 0, gross: 0, cx: 0, av: 0, avx: 0, nav: 0, ca: 0, nR: 0, cpg: 0, cpNav: 0, cpCa: 0, dNav: 0, dCa: 0, cc: {}, noProj: 0 }; }
    function month(from, to, G, total) {
      data.W.forEach(function (r) {
        var v = r[ix.vday]; if (r[ix.kind] !== 0 || v < from || v > to) return; var p = P(r);
        if (real(p) && inScope(p)) { (G[p] = G[p] || blank()).fresh++; }
        if (all || (real(p) && inScope(p))) total.fresh++;
        if (!real(p)) total.noProj++;
      });
      BKS.forEach(function (b) {
        if (!real(b.p) || !inScope(b.p)) return; var g = G[b.p] = G[b.p] || blank();
        [g, total].forEach(function (s) {
          if (b.bday >= from && b.bday <= to) {
            s.gross++; if (b.cp) s.cpg++; s.av += b.av || 0;
            if (!b.cx && b.av > 0 && b.ca > 0 && okRate(b)) {
              var n = b.av * (b.cp ? 1 - BRK : 1); s.nav += n; s.ca += b.ca; s.nR++;
              if (b.cfg) { var e = s.cc[b.cfg] = s.cc[b.cfg] || { nav: 0, ca: 0, n: 0 }; e.nav += n; e.ca += b.ca; e.n++; }
              if (b.cp) { s.cpNav += n; s.cpCa += b.ca; } else if (b.dir) { s.dNav += n; s.dCa += b.ca; }
            }
          }
          if (b.cx && b.cday >= from && b.cday <= to) { s.cx++; s.avx += b.av || 0; }
        });
      });
    }
    var G = {}, T = blank(); month(R.from, R.to, G, T);
    // the 3 months before: usual net bookings a month, and ₹/sq ft over all their bookings together
    var U = {}, PR = {};
    for (var i = 1; i <= 3; i++) {
      var r3 = range(ymAdd(ym, -i)), g3 = {}; month(r3.from, r3.to, g3, blank());
      for (var p3 in g3) {
        U[p3] = (U[p3] || 0) + (g3[p3].gross - g3[p3].cx) / 3;
        var q = PR[p3] = PR[p3] || { nav: 0, ca: 0, nR: 0, cc: {} }; q.nav += g3[p3].nav; q.ca += g3[p3].ca; q.nR += g3[p3].nR;
        for (var c in g3[p3].cc) { var e = q.cc[c] = q.cc[c] || { nav: 0, ca: 0, n: 0 }, f = g3[p3].cc[c]; e.nav += f.nav; e.ca += f.ca; e.n += f.n; }
      }
    }
    // targets: a project's own rows (column C = that project). Company total: every row when "all projects".
    var PT = {}, tB = 0, tW = 0, untagged = 0;   // untagged = target rows still saying "All" instead of a project
    (data.CT || []).forEach(function (t) { if (t[1] !== ym) return; var p = t[4] || "All"; if (real(p)) { (PT[p] = PT[p] || { b: 0, w: 0, hb: false, hw: false }).b += +t[2] || 0; PT[p].hb = true; } else untagged++; if (all || want[p]) tB += +t[2] || 0; });
    (data.ST || []).forEach(function (t) { if (t[1] !== ym) return; var p = t[5] || "All"; if (real(p)) { (PT[p] = PT[p] || { b: 0, w: 0, hb: false, hw: false }).w += +t[3] || 0; PT[p].hw = true; } else untagged++; if (all || want[p]) tW += +t[3] || 0; });

    // projects to report: the chosen ones, or every project with activity or a target
    var names = {}; for (var gp in G) names[gp] = 1; for (var up in U) names[up] = 1; for (var tp in PT) names[tp] = 1;
    if (!all) names = want;
    var lastBk = {}; BKS.forEach(function (b) { if (real(b.p) && b.bday <= R.to && !b.cx && !(lastBk[b.p] >= b.bday)) lastBk[b.p] = b.bday; });
    var list = Object.keys(names).filter(function (p) { return p !== "*" && real(p); }).map(function (p) {
      var s = G[p] || blank(), net = s.gross - s.cx, u = U[p] || 0, t = PT[p] || {}, pr = PR[p] || { nR: 0, ca: 0, nav: 0, cc: {} };
      var bT = t.hb ? t.b : null, wT = t.hw ? t.w : null;
      var bPct = bT ? Math.round(net / bT * 100) : null, wPct = wT ? Math.round(s.fresh / wT * 100) : null;
      // status: against the project's own booking target when one is given, else against its usual month
      var ratio = bT ? net / bT : u > 0 ? net / u : net > 0 ? 1 : 0;
      var h = !bT && u < 0.5 && net <= 0 ? (s.fresh >= 10 ? "nobk" : "idle") : ratio >= 0.9 ? "good" : ratio >= 0.6 ? "warn" : "bad";
      // ₹/sq ft against the 3 months before: only when both sides have at least 3 bookings, and only a 5% move counts
      var rate = s.ca ? s.nav / s.ca : null, prev = pr.ca ? pr.nav / pr.ca : null, rch = null;
      if (rate && prev && s.nR >= 3 && pr.nR >= 3) rch = (rate - prev) / prev;
      // like for like: each configuration against its own ₹/sq ft in the 3 months before (at least 3 bookings on each side),
      // so a different mix of flats sold is never mistaken for a price cut
      var lfl = Object.keys(s.cc).filter(function (c) { return s.cc[c].n >= 3 && pr.cc[c] && pr.cc[c].n >= 3; }).map(function (c) {
        var now = s.cc[c].nav / s.cc[c].ca, was = pr.cc[c].nav / pr.cc[c].ca; return { c: c, now: now, was: was, ch: (now - was) / was, n: s.cc[c].n };
      }).sort(function (a, b) { return b.n - a.n; });
      var cut = lfl.filter(function (l) { return l.ch <= -0.05; });
      return { p: p, s: s, net: net, usual: u, health: h, bT: bT, wT: wT, bPct: bPct, wPct: wPct, sv: s.av - s.avx, rate: rate, prev: prev, rch: rch, lfl: lfl, cut: cut, nR: s.nR, pnR: pr.nR, last: lastBk[p] };
    });
    var rank = { bad: 0, warn: 1, nobk: 2, good: 3, idle: 4 };
    list.sort(function (a, b) { return rank[a.health] - rank[b.health] || (b.bT || b.usual) - (a.bT || a.usual) || a.p.localeCompare(b.p); });
    var shown = list.filter(function (x) { return x.health !== "idle"; }), idle = list.filter(function (x) { return x.health === "idle"; });

    var net = T.gross - T.cx, pct = tB ? Math.round(net / tB * 100) : null, wpct = tW ? Math.round(T.fresh / tW * 100) : null;
    var noProjShare = T.fresh ? T.noProj / T.fresh : 0, walkOk = noProjShare < 0.3;   // project walk-ins mean something only when most carry a project

    // per project: what is off (f) and what to ask (q), only where something is off; w = how serious (lower first)
    shown.forEach(function (x) {
      var A = [], s = x.s;
      if (x.health === "nobk") A.push({ w: 3, f: fmt(s.fresh) + " walk-ins but no booking recorded", q: "Are bookings missing from Booking details?" });
      else if (x.health === "bad" || x.health === "warn") {
        var vs = x.bT ? "target " + fmt(x.bT) : "usual " + x.usual.toFixed(1) + " a month";
        A.push({ w: x.health === "bad" ? 1 : 4, f: x.net <= 0 ? "No net booking in " + M + (x.last ? ", last on " + dl(x.last) : "") : sgn(x.net) + " net bookings against " + vs, q: "What is holding bookings back, and what is the plan for " + NEXT + "?" });
      }
      if (s.cx >= 2 && s.cx / Math.max(1, s.gross) >= 0.25) A.push({ w: 2, f: s.cx + " cancellations against " + s.gross + " booked", q: "Why did these buyers cancel?" });
      if (sec.realisation) {
        var lf = function (l) { return l.c + " ₹" + fmt(l.was) + " → ₹" + fmt(l.now) + " (" + (l.ch < 0 ? "▼" : "▲") + Math.round(Math.abs(l.ch) * 100) + "%)"; };
        // a configuration sold cheaper than before = price, whatever the overall average did
        if (x.cut.length) A.push({ w: 2, f: "Price down on the same flats: " + x.cut.map(lf).join(", "), q: "What discounts were given, and who approved them?" });
        else if (x.rch != null && x.rch <= -0.05) {
          if (x.lfl.length) A.push({ w: 6, f: "₹/sq ft down " + Math.round(-x.rch * 100) + "% overall, but prices held: " + x.lfl.map(lf).join(", ") + ". The drop is the mix of flats sold.", q: "" });
          else A.push({ w: 4, f: "₹/sq ft down " + Math.round(-x.rch * 100) + "% overall; too few bookings per configuration to tell price from mix", q: "Were any discounts given?" });
        }
      }
      if (walkOk && x.wT && x.wPct < 80 && x.health !== "bad") A.push({ w: 5, f: "Walk-ins at " + x.wPct + "% of target", q: "What is sourcing doing about the lead flow?" });
      A.sort(function (a, b) { return a.w - b.w; });
      x.ask = A;
    });

    var dec = [];
    // ---------- more business facts ----------
    var hist = []; for (var hi = 5; hi >= 0; hi--) { var hm = ymAdd(ym, -hi), hr = range(hm), ht = blank(); month(hr.from, hr.to, {}, ht); var hb = 0; (data.CT || []).forEach(function (t) { if (t[1] === hm && (all || want[t[4] || "All"])) hb += +t[2] || 0; }); hist.push({ ym: hm, m: MON[hr.m], net: ht.gross - ht.cx, sv: ht.av - ht.avx, fresh: ht.fresh, t: hb }); }
    var PMn = MON[(R.m + 11) % 12], prevM = hist[4], a3 = { sv: 0, net: 0, fresh: 0 }; hist.slice(2, 5).forEach(function (x) { a3.sv += x.sv / 3; a3.net += x.net; a3.fresh += x.fresh; });
    var G1 = {}; (function () { var r1 = range(ymAdd(ym, -1)); month(r1.from, r1.to, G1, blank()); })();
    var sqft = {}, sqT = 0, noVal = 0, cm = {}, firm = {}, firmP = {}, cxBy = {}, svCP = 0, svD = 0, nCP = 0, nD = 0, valued = 0;
    BKS.forEach(function (b) {
      if (!real(b.p) || !inScope(b.p)) return;
      if (b.bday >= R.from && b.bday <= R.to) {
        sqft[b.p] = (sqft[b.p] || 0) + (b.ca > 0 ? b.ca : 0); sqT += b.ca > 0 ? b.ca : 0; if (!(b.av > 0)) noVal++; else valued++;
        if (b.cm) cm[b.cm] = (cm[b.cm] || 0) + 1; if (b.cp) { nCP++; svCP += b.av || 0; if (b.firm) { firm[b.firm] = (firm[b.firm] || 0) + 1; (firmP[b.p] = firmP[b.p] || {})[b.firm] = (firmP[b.p][b.firm] || 0) + 1; } } else if (b.dir) { nD++; svD += b.av || 0; }
      }
      if (b.cx && b.cday >= R.from && b.cday <= R.to) { sqft[b.p] = (sqft[b.p] || 0) - (b.ca > 0 ? b.ca : 0); sqT -= b.ca > 0 ? b.ca : 0; if (b.cm) cm[b.cm] = (cm[b.cm] || 0) - 1; cxBy[b.p] = (cxBy[b.p] || 0) + 1; }
    });
    var bestCm = Object.keys(cm).filter(function (k) { return cm[k] >= 2; }).sort(function (a, b) { return cm[b] - cm[a]; })[0];
    var proper = function (s) { return String(s).toLowerCase().replace(/(^|\s)[a-z]/g, function (x) { return x.toUpperCase(); }); };
    var firms = Object.keys(firm).sort(function (a, b) { return firm[b] - firm[a]; }), top3 = firms.slice(0, 3).reduce(function (a, k) { return a + firm[k]; }, 0);
    var ticket = valued ? T.av / valued : 0, short = tB && net < tB ? tB - net : 0, sv = T.av - T.avx, SVM = noVal ? " (" + noVal + " booking" + (noVal > 1 ? "s" : "") + " without a value)" : "";
    var chg = function (a, b) { return b > 0 ? (a - b) / b * 100 : null; };
    var chT = function (v, lab) { return v == null ? "" : (Math.abs(v) < 1 ? "same as " + lab : (v > 0 ? "▲ " : "▼ ") + Math.round(Math.abs(v)) + "% vs " + lab); };
    var cnt = function (a, b, lab) { var d = Math.round((a - b) * 10) / 10; return d === 0 ? "same as " + lab : (d > 0 ? "▲ " : "▼ ") + Math.abs(d) + " vs " + lab; };
    var svC = chg(sv, prevM.sv), sv3 = chg(sv, a3.sv);

    // Decisions: only what management can act on. Each has the fact (f), its ₹ size (k), why (w), the choice (d), owner.
    // Ranked by ₹. A cause is stated only when the data supports it. Missing targets and data-entry points go to Data confidence.
    var hasT = function (x) { return x.bT > 0; };
    // behind = short of its own target; without a target: clearly below its usual month (2 or more, or 1.5 and under 60%)
    var gapOf = function (x) { return (hasT(x) ? x.bT : x.usual) - x.net; };
    var isBehind = function (x) { var g = gapOf(x); return hasT(x) ? g >= 1 && x.net / x.bT < 0.9 : g >= 2 && x.net / x.usual < 0.9 || g >= 1.5 && x.net / x.usual < 0.6; };
    var noT = shown.filter(function (x) { return !hasT(x); });
    // the 3 months before, per project and in total
    var B3 = {}, T3 = blank(), tagOk = walkOk, K3 = {}, K0 = { d: 0, i: 0 };
    for (var bi = 1; bi <= 3; bi++) { var br = range(ymAdd(ym, -bi)), bg = {}, bt = blank(); month(br.from, br.to, bg, bt); if (!bt.fresh || bt.noProj / bt.fresh >= 0.3) tagOk = false; for (var bk in bt) if (typeof bt[bk] === "number") T3[bk] += bt[bk]; for (var bp in bg) { var bo = B3[bp] = B3[bp] || blank(); ["fresh", "gross", "cx", "av", "avx"].forEach(function (k) { bo[k] += bg[bp][k]; }); } }
    var from3 = range(ymAdd(ym, -3)).from, V3 = {}, C0 = {};
    BKS.forEach(function (b) {
      if (!real(b.p) || !inScope(b.p) || b.bday < from3 || b.bday > R.to) return; var c = b.cp ? "i" : b.dir ? "d" : "";
      if (b.bday >= R.from) { if (c) { var q0 = C0[b.p] = C0[b.p] || { d: 0, i: 0 }; q0[c]++; } return; }
      if (b.av > 0) { var v3 = V3[b.p] = V3[b.p] || { s: 0, n: 0 }; v3.s += b.av; v3.n++; }
      if (c) { var q3 = K3[b.p] = K3[b.p] || { d: 0, i: 0 }; q3[c]++; K0[c]++; }
    });
    // a project's own average value: last 3 months, else this month, else the company's
    var tkOf = function (x) { var v = V3[x.p]; return v && v.n >= 3 ? v.s / v.n : x.s.gross && x.s.av ? x.s.av / x.s.gross : v && v.n ? v.s / v.n : ticket; };
    // flats as the Inventory tab stands today; projects missing there get no stock statement
    var ST = {}; (data.INV || []).forEach(function (r) { var o = ST[r[0]] = ST[r[0]] || { n: 0, u: 0, h: 0 }; o.n++; if (r[3] === "Unsold") o.u++; else if (r[3] === "On hold") o.h++; });
    // stock is used only where the Inventory tab looks complete: it must show at least 90% of the project's active bookings as sold
    var act = {}; BKS.forEach(function (b) { if (!b.cx && b.p) act[b.p] = (act[b.p] || 0) + 1; });
    for (var sp in ST) if (!(act[sp] >= 5) || ST[sp].n - ST[sp].u < act[sp] * 0.9) delete ST[sp];
    var noSt = shown.filter(function (x) { return !ST[x.p]; });
    var pl = function (n, w) { return fmt(n) + " " + w + (n === 1 ? "" : "s"); }, one = function (v) { return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, ""); };
    var BY = " by 10 " + NEXT, risks = [], opps = [], used = {};
    shown.forEach(function (x) {
      var s = x.s, b3 = B3[x.p] || blank(), st = ST[x.p], tk = tkOf(x), uG = b3.gross / 3, uF = b3.fresh / 3;
      var stock = st ? pl(st.u, "flat") + " unsold today" + (st.h ? " (" + st.h + " on hold)" : "") + (x.usual >= 0.5 && st.u ? ", about " + fmt(Math.ceil(st.u / x.usual)) + " months at the recent pace" : "") : "";
      var noStock = st && st.u < Math.max(2, x.usual);
      var cuts = sec.realisation ? x.cut : [], loss = cuts.reduce(function (a, l) { return a + (l.was - l.now) * s.cc[l.c].ca; }, 0);
      var cutT = cuts.map(function (l) { return l.c + " ₹" + fmt(l.was) + " → ₹" + fmt(l.now) + " per sq ft (" + Math.round(l.ch * 100) + "%, " + l.n + " flats)"; }).join("; ").replace(/\(-/g, "(−");
      if (isBehind(x)) {
        var g = gapOf(x), W = [], d = "", o = "Sales head", cause = "";
        // gap on bookings made, or on cancellations?
        if (noStock) { cause = "stock"; W.push("Little left to sell: " + stock); d = "Release or unblock more flats in " + x.p + ", or move its team and leads to a project with stock"; }
        else if (s.cx && s.gross >= uG * 0.9 && s.gross > 0) { cause = "cx"; W.push("Bookings held (" + s.gross + " against a usual " + one(uG) + "); " + pl(s.cx, "cancellation") + " took them back" + (s.avx ? ", " + fcr(s.avx) : "")); d = "Approve a rebooking offer for these buyers, or release the flats for sale now"; o = "Sales head"; }
        else if (hasT(x) && uG > 0 && s.gross >= uG * 0.95) { cause = "target"; W.push("Bookings were normal (" + s.gross + " against a usual " + one(uG) + "); the target is above a normal month"); d = "Fund more walk-ins or a better offer in " + x.p + " to reach it, or reset the target"; }
        else if (tagOk && uF >= 10 && uG > 0) {
          var c3p = uG / uF, eW = (uF - s.fresh) * c3p, eC = s.fresh * c3p - s.gross;
          W.push("Walk-ins " + fmt(s.fresh) + " against a usual " + fmt(uF) + "; bookings " + s.gross + " against a usual " + one(uG));
          if (eW > 0 && eW >= eC) { cause = "walk"; W.push("Main cause: fewer walk-ins"); d = "Put more marketing and partner spend into " + x.p + ", or accept a lower " + NEXT + " number"; o = "Sales head and Sourcing head"; }
          else if (eC > 0) { cause = "conv"; W.push("Main cause: walk-ins came but did not book"); d = cuts.length ? "Price was already cut and bookings still fell: change the closing team or the offer, not the price" : "Change the price or offer in " + x.p + ", or put a stronger closing team there"; }
        } else {
          var a0 = C0[x.p] || { d: 0, i: 0 }, a3p = K3[x.p] || { d: 0, i: 0 }, dD = a3p.d / 3 - a0.d, dI = a3p.i / 3 - a0.i;
          if (a3p.d + a3p.i + a0.d + a0.i) W.push("Direct " + a0.d + " against a usual " + one(a3p.d / 3) + "; partners " + a0.i + " against a usual " + one(a3p.i / 3));
          var known = a3p.d + a3p.i >= 4 && Math.max(dD, dI) >= 1;
          if (known && dI >= 2 * Math.max(dD, 0.01)) { cause = "ind"; W.push("Most of the fall is in partner bookings"); d = "Give partners a reason to bring buyers to " + x.p + " (incentive or new firms), or shift spend to direct marketing"; o = "Sourcing head"; }
          else if (known && dD >= 2 * Math.max(dI, 0.01)) { cause = "dir"; W.push("Most of the fall is in direct bookings"); d = "Approve direct marketing for " + x.p + ", or lean on partners and accept the brokerage"; o = "Sales head"; }
          else if (known && dD > 0 && dI > 0) { cause = "both"; W.push("Both channels fell, so the project itself needs a look (price, offer or competition), not one channel"); d = "Change the price or offer in " + x.p + ", or move spend to a project that is selling"; }
          else d = "Ask for the open-customer list, then choose: change the offer in " + x.p + ", or move spend to a project that is selling";
        }
        if (stock && cause !== "stock") W.push(stock);
        if (cuts.length) W.push("Price also fell: " + cutT);
        if (s.cx && cause !== "cx") W.push(pl(s.cx, "cancellation") + " in the month" + (s.avx ? ", " + fcr(s.avx) : ", value not entered"));
        used[x.p] = 1;
        risks.push({ p: x.p, kind: "gap", k: g * tk, lvl: x.net / (hasT(x) ? x.bT : x.usual) < 0.6 ? "bad" : "warn", t: x.p + ": " + sgn(x.net) + " net booking" + (Math.abs(x.net) === 1 ? "" : "s") + " against " + (hasT(x) ? "a target of " + fmt(x.bT) : "a usual " + one(x.usual)), f: tk ? "About " + fcr(g * tk) + " of sales value missed" : "", w: W, d: d, o: o + "," + BY });
      } else if (cuts.length) {
        used[x.p] = 1;
        risks.push({ p: x.p, kind: "price", k: loss * 3, lvl: "bad", t: x.p + ": the same flats sold cheaper", f: "About " + fcr(loss) + " given up in " + M, w: [cutT, hasT(x) ? sgn(x.net) + " net bookings against a target of " + fmt(x.bT) : sgn(x.net) + " net bookings against a usual " + one(x.usual), stock].filter(Boolean), d: x.net > x.usual * 1.1 ? "Bookings rose along with the lower price: keep it on purpose, or set a discount limit" : "Bookings did not rise with the lower price: restore the price, or approve a discount limit", o: "Sales head," + BY });
      } else {
        // doing well: room to push (only with a clear lead and stock left)
        var up = x.net - x.usual, good = x.net >= 4 && x.usual >= 1 && up >= 2 && x.net >= x.usual * 1.25 && (!hasT(x) || x.net >= x.bT);
        if (st && x.usual >= 1 && st.u > 0 && st.u / Math.max(x.usual, x.net) < 3) { used[x.p] = 1; risks.push({ p: x.p, kind: "stock", k: st.u * tk * 0.25, lvl: "warn", t: x.p + ": stock is running out", f: pl(st.u, "flat") + " left, about " + fcr(st.u * tk), w: ["Selling " + x.net + " in " + M + ", usual " + one(x.usual) + " a month" + (st.h ? "; " + st.h + " more on hold" : "")], d: "Raise the price on the last flats, or release held flats; move the team next", o: "Sales head," + BY }); }
        else if (good && (!st || st.u >= 5)) { used[x.p] = 1; opps.push({ p: x.p, kind: "opp", k: up * tk, lvl: "good", t: x.p + ": " + x.net + " net bookings against a usual " + one(x.usual), f: "About " + fcr(up * tk) + " more than usual", w: [x.rch != null ? "Price " + (Math.abs(x.rch) < 0.05 ? "held steady" : x.rch > 0 ? "rose " + Math.round(x.rch * 100) + "% per sq ft" : "is " + Math.round(-x.rch * 100) + "% lower on a different mix of flats") : "", stock].filter(Boolean), d: "Test a small price rise" + (st ? " (1% on the unsold flats is about " + fcr(st.u * tk * 0.01) + ")" : "") + ", or add leads and people while it is selling", o: "Sales head," + BY }); }
      }
    });
    // the company against its target
    if (short && net / tB < 0.9) {
      var cw = [], cd = "Agree how the gap is recovered in " + NEXT + ", or reset the target", co = "Sales head", coOk = all || walkOk;
      if (coOk && T3.fresh >= 30 && T.fresh && T3.gross) {
        var uf = T3.fresh / 3, cc3 = T3.gross / T3.fresh, w1 = (uf - T.fresh) * cc3, w2 = T.fresh * cc3 - T.gross;
        var wt = "Walk-ins " + fmt(T.fresh) + " against a usual " + fmt(uf), ct = "walk-in to booking " + (T.gross / T.fresh * 100).toFixed(1) + "% against a usual " + (cc3 * 100).toFixed(1) + "%";
        cw.push(wt + "; " + ct);
        var g3 = T3.gross / 3, x3 = T3.cx / 3, moreCx = T.cx - x3 >= 2 && T.cx >= x3 * 1.5;
        if (T.gross >= g3 * 0.95 || moreCx && T.cx - x3 >= g3 - T.gross) {
          cw.push("Bookings made " + T.gross + " against a usual " + one(g3) + "; cancelled " + T.cx + " against a usual " + one(x3));
          if (moreCx) { cw.push("Main cause: cancellations"); cd = "Approve a retention offer for cancelling buyers, and check the booking amount and loan checks taken at booking"; co = "Sales head"; }
          else { cw.push("Main cause: the target is above a normal month (" + one(g3 - x3) + " net)"); cd = "Fund more walk-ins or better conversion to reach it, or reset the target"; }
        }
        else if (w1 >= 1 && w1 >= w2) { cw.push("Main cause: fewer walk-ins"); cd = "Approve more marketing and partner spend for " + NEXT + ", or accept a lower number"; co = "Sales head and Sourcing head"; }
        else if (w2 >= 1) { cw.push("Main cause: walk-ins came but did not book"); cd = "Change the price or offer, or strengthen closing where bookings fell. More leads alone will not fix this"; }
        else cw.push("Walk-ins and conversion are each only slightly below usual");
      }
      var inc = risks.filter(function (x) { return x.kind === "gap"; }).map(function (x) { return x.p; });
      if (inc.length) cw.push("Projects behind: " + inc.join(", "));
      risks.push({ kind: "co", k: short * ticket + 1e12, lvl: net / tB < 0.8 ? "bad" : "warn", t: "Company: " + pl(short, "booking") + " short of the " + M + " target of " + fmt(tB), f: ticket ? "About " + fcr(short * ticket) + " of sales value missed" : "", w: cw, d: cd, o: co + "," + BY });
    }
    // walk-ins but no booking in this month or the three before
    var dry = shown.filter(function (x) { return !used[x.p] && x.s.fresh >= 10 && !x.s.gross && !(B3[x.p] && B3[x.p].gross); }), dryN = dry.reduce(function (a, x) { return a + x.s.fresh; }, 0);
    if (dry.length) { dry.forEach(function (x) { used[x.p] = 1; }); risks.push({ kind: "dry", k: 0, lvl: "warn", t: (dry.length === 1 ? dry[0].p : dry.length + " projects") + ": " + pl(dryN, "walk-in") + " and no booking in 4 months", f: "Effort is going in and nothing is coming back", w: [dry.length > 1 ? dry.map(function (x) { return x.p + " " + x.s.fresh; }).join(", ") : "", "First rule out bookings missing from Booking details"].filter(Boolean), d: "Open " + (dry.length === 1 ? "it" : "them") + " for sale at a price that books, or stop spending on leads there", o: "Sales head," + BY }); }
    // cancellations across the company
    var cxNote = T.cx >= 2 && T.cx < T3.cx / 3 && T.avx < 1e7 ? pl(T.cx, "cancellation") + ", below the usual " + one(T3.cx / 3) : "";
    if (T.cx >= 2 && !cxNote) {
      var ucx = T3.cx / 3, cxS = Object.keys(cxBy).sort(function (a, b) { return cxBy[b] - cxBy[a]; });
      risks.push({ kind: "cx", k: T.avx, lvl: T.cx / Math.max(1, T.gross) >= 0.25 || T.cx >= ucx * 1.5 && T.cx - ucx >= 2 ? "bad" : "warn", t: T.cx + " cancellations against a usual " + one(ucx) + " a month", f: (T.avx ? fcr(T.avx) + " lost" : "Value not entered") + (T.gross ? "; " + T.cx + " cancelled for " + T.gross + " booked" : ""), w: [cxS.map(function (p) { var g = G[p] || blank(); return p + " " + cxBy[p] + (g.avx ? " (" + fcr(g.avx) + ")" : ""); }).join(", ")], d: "Approve a retention offer for buyers who can be saved, and release the other flats for sale now", o: "Sales head," + BY });
    }
    // dependence on one partner, and a swing from direct to partner bookings
    if (firms.length && T.gross >= 8 && firm[firms[0]] / T.gross >= 0.25) {
      var fp = Object.keys(firmP).filter(function (p) { return firmP[p][firms[0]]; }).sort(function (a, b) { return firmP[b][firms[0]] - firmP[a][firms[0]]; }).map(function (p) { return p + " " + firmP[p][firms[0]]; });
      risks.push({ kind: "firm", k: firm[firms[0]] * ticket * 0.25, lvl: "warn", t: "One partner brought " + Math.round(firm[firms[0]] / T.gross * 100) + "% of bookings", f: firms[0] + ": " + firm[firms[0]] + " of " + T.gross + " bookings" + (ticket ? ", about " + fcr(firm[firms[0]] * ticket) : ""), w: ["By project: " + fp.join(", "), "If this firm slows, these bookings go with it"], d: "Secure this firm on agreed terms, or fund 2 to 3 more firms so no one firm passes 20%", o: "Sourcing head," + BY });
    }
    var sh0 = nCP + nD >= 10 ? nCP / (nCP + nD) : null, sh3 = K0.d + K0.i >= 20 ? K0.i / (K0.d + K0.i) : null;
    if (sh0 != null && sh3 != null && sh0 - sh3 >= 0.1 && svCP) risks.push({ kind: "chan", k: Math.max(0, svCP - sh3 * (svCP + svD)) * BRK, lvl: "warn", t: "Bookings are moving to partners: " + Math.round(sh0 * 100) + "% against a usual " + Math.round(sh3 * 100) + "%", f: "Brokerage about " + fcr(svCP * BRK) + " in " + M + (svCP > sh3 * (svCP + svD) ? ", about " + fcr((svCP - sh3 * (svCP + svD)) * BRK) + " more than at the usual mix" : ""), w: ["Direct " + nD + ", usual " + one(K0.d / 3) + " a month; partners " + nCP + ", usual " + one(K0.i / 3)], d: "Fund direct marketing and referrals, or accept the higher brokerage", o: "Sales head," + BY });
    risks.sort(function (a, b) { return b.k - a.k; }); opps.sort(function (a, b) { return b.k - a.k; });
    var also = risks.slice(5).concat(opps.slice(1)).map(function (x) { return x.t; }).concat(cxNote ? [cxNote] : []);
    dec = risks.slice(0, 5).concat(opps.slice(0, 1));
    // the one thing to look at first
    var gaps = risks.filter(function (x) { return x.kind === "gap"; }), focus = "";
    if (gaps.length) focus += "Look first at " + gaps.slice(0, 2).map(function (x) { return x.p + (x.k ? " (about " + fcr(x.k) + ")" : ""); }).join(" and ") + ".";
    
    var quiet = shown.filter(function (x) { return !used[x.p]; }).map(function (x) { return x.p; });

    var vT = fcr(sv), head = M + " " + R.y + ": " + vT + " from " + fmt(net) + " net booking" + (net === 1 ? "" : "s") + (tB ? (short ? ', <span style="color:#FCD34D;">' + fmt(short) + " short of target</span>" : ', <span style="color:#86EFAC;">target met</span>') : "");
    var top = shown.filter(function (x) { return x.net > 0; }).sort(function (a, b) { return b.net - a.net; })[0];
    var sub2 = (svC != null ? "Sales value is " + (Math.abs(svC) < 1 ? "level with " + PMn : Math.round(Math.abs(svC)) + "% " + (svC > 0 ? "above " : "below ") + PMn) + (sv3 != null ? " and " + (Math.abs(sv3) < 1 ? "level with" : Math.round(Math.abs(sv3)) + "% " + (sv3 > 0 ? "above" : "below")) + " the 3-month average" : "") + ". " : "") + (top ? top.p + " led with " + top.net + (top.net < net ? " of " + net : "") + " net booking" + (top.net === 1 ? "" : "s") + "." : "");
    var subject = M + " sales: " + vT + ", " + fmt(net) + " bookings" + (tB ? " (" + pct + "% of target)" : "") + (dec.length ? " · " + dec.length + " decision" + (dec.length > 1 ? "s" : "") : "");
    var pre = sub2;

    // ---------- HTML: full width on a laptop, one column on a phone; tables and inline styles only ----------
    var FN = "font-family:'Segoe UI',Arial,sans-serif;", C = { good: "#15803D", warn: "#B45309", bad: "#B91C1C", mute: "#64605F", line: "#E5E3E2", ink: "#1C1A1B" };
    var txt = function (s, size, lh, col, w, top) { return '<p style="margin:' + (top || 0) + 'px 0 0;font-size:' + size + 'px;line-height:' + lh + 'px;mso-line-height-rule:exactly;color:' + (col || C.ink) + ';font-weight:' + (w || 400) + ';' + FN + '">' + s + '</p>'; };
    var h2 = function (t, s) { return txt(t, 18, 24, C.ink, 600) + (s ? txt(s, 13, 20, C.mute, 400, 2) : ""); };
    var sg = function (v) { return v == null ? C.mute : v >= 1 ? C.good : v <= -1 ? C.bad : C.mute; };
    var stc = function (p) { return p == null ? "#8A8787" : p >= 100 ? C.good : p >= 80 ? C.warn : C.bad; };
    var tile = function (bar, lab, big, small, l1, c1, l2) { return '<td class="k" width="25%" valign="top" style="padding:8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td height="4" bgcolor="' + bar + '" style="background:' + bar + ';font-size:0;line-height:4px;mso-line-height-rule:exactly;">&nbsp;</td></tr><tr><td height="112" valign="top" bgcolor="#FFFFFF" style="height:112px;background:#FFFFFF;padding:16px;border:1px solid ' + C.line + ';border-top:0;">' + txt(lab, 13, 18, C.mute, 600) + txt(big + (small ? '<span style="font-size:15px;color:' + C.mute + ';font-weight:400;"> ' + small + '</span>' : ""), 28, 36, C.ink, 600, 4) + txt(l1 || "&nbsp;", 13, 18, c1, 600, 4) + txt(l2 || "&nbsp;", 12, 18, C.mute, 400, 2) + '</td></tr></table></td>'; };
    var cons = T.fresh ? net / T.fresh * 100 : null, c3 = a3.fresh ? a3.net / a3.fresh * 100 : null, okC = cons != null && cons >= 0 && cons <= 100;
    var tiles = '<tr>' + tile(sv3 == null ? "#8A8787" : sv3 >= -1 ? C.good : sv3 >= -20 ? C.warn : C.bad, "Sales value", vT, "", chT(svC, PMn), sg(svC), sgn(sqT) + " sq ft sold · " + chT(sv3, "3-month average")) +
      tile(stc(pct), "Net bookings", sgn(net), tB ? "of " + fmt(tB) : "", pct != null ? pct + "% of target" : "No target assigned", tB ? stc(pct) : C.bad, fmt(T.gross) + " booked, " + T.cx + " cancelled · " + cnt(net, prevM.net, PMn)) +
      tile(stc(wpct), "Fresh walk-ins", fmt(T.fresh), tW ? "of " + fmt(tW) : "", wpct != null ? wpct + "% of target" : "No target assigned", tW ? stc(wpct) : C.bad, chT(chg(T.fresh, prevM.fresh), PMn)) +
      tile(okC && c3 != null ? (cons >= c3 - 0.5 ? C.good : C.warn) : "#8A8787", "Walk-in to booking", okC ? cons.toFixed(1) + "%" : "–", "", okC && c3 != null ? (Math.abs(cons - c3) < 0.5 ? "level" : (cons > c3 ? "▲ " : "▼ ") + Math.abs(cons - c3).toFixed(1) + " pts") + " vs 3-month average" : "", okC && c3 != null ? (cons - c3 >= 0.5 ? C.good : cons - c3 <= -0.5 ? C.bad : C.mute) : C.mute, fmt(net) + " of " + fmt(T.fresh) + " walk-ins") + '</tr>';

    // six-month bars (plain table cells, so every mail app draws them)
    var mx = Math.max.apply(null, hist.map(function (x) { return Math.max(x.sv, 1); }));
    var bars = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>' + hist.map(function (x, n) { var hgt = Math.max(4, Math.round(Math.max(0, x.sv) / mx * 120)), col = n === 5 ? "#B3261E" : "#CFCBCA"; return '<td align="center" valign="bottom" height="150" style="padding:0 4px;">' + txt('<span style="white-space:nowrap;">' + (x.sv ? (x.sv / 1e7).toFixed(1) : "0") + '</span>', 13, 16, n === 5 ? "#B3261E" : C.mute, 600) + '<table role="presentation" width="36" cellpadding="0" cellspacing="0" align="center" style="border-collapse:collapse;"><tr><td height="' + hgt + '" bgcolor="' + col + '" style="height:' + hgt + 'px;background:' + col + ';font-size:0;line-height:' + hgt + 'px;mso-line-height-rule:exactly;">&nbsp;</td></tr></table></td>'; }).join("") + '</tr><tr>' + hist.map(function (x, n) { return '<td align="center" style="padding:8px 2px 0;border-top:1px solid ' + C.line + ';">' + txt(x.m, 13, 18, n === 5 ? C.ink : C.mute, n === 5 ? 600 : 400) + txt(sgn(x.net) + (x.t ? " of " + fmt(x.t) : ""), 12, 16, C.mute) + '</td>'; }).join("") + '</tr></table>';

    var decC = dec.map(function (x, n) { var c = x.lvl === "bad" ? C.bad : x.lvl === "good" ? C.good : C.warn; return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td width="4" bgcolor="' + c + '" style="background:' + c + ';font-size:0;">&nbsp;</td><td bgcolor="#FAF9F9" style="background:#FAF9F9;padding:12px 16px;">' + txt((n + 1) + ". " + esc(x.t), 16, 22, C.ink, 600) + (x.f ? txt(esc(x.f), 14, 20, c, 600, 2) : "") + x.w.map(function (q, i) { return txt((i ? "" : "<b>Why:</b> ") + esc(q) + ".", 14, 20, "#3A3737", 400, i ? 2 : 6); }).join("") + txt("<b>Decide:</b> " + esc(x.d) + ".", 14, 20, C.ink, 400, 6) + txt("<b>Owner:</b> " + esc(x.o), 13, 18, C.mute, 400, 4) + '</td></tr></table>'; }), decR = "", gapC = '<td class="gap" width="2%" style="font-size:0;">&nbsp;</td>';
    if (decC.length % 2) decR = '<tr><td colspan="3" style="padding:0 0 12px;">' + decC[0] + '</td></tr>';   // odd number: the biggest takes the full width
    for (var di = decC.length % 2; di < decC.length; di += 2) decR += '<tr><td class="col" width="49%" valign="top" style="padding:0 0 12px;">' + decC[di] + '</td>' + gapC + '<td class="col" width="49%" valign="top" style="padding:0 0 12px;">' + decC[di + 1] + '</td></tr>';
    var decH = decC.length ? '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">' + decR + '</table></td></tr>' : '<tr><td bgcolor="#E8F5EC" style="background:#E8F5EC;padding:16px;">' + txt("Nothing needs a decision this month.", 14, 20, C.good, 600) + '</td></tr>';

    if (also.length) decH += '<tr><td style="padding:0 0 12px;">' + txt("<b>Also note:</b> " + esc(also.join("; ")) + ".", 13, 20, C.mute) + '</td></tr>';
    if (quiet.length) decH += '<tr><td style="padding:0 0 12px;">' + txt("<b>No project decision needed:</b> " + esc(quiet.join(", ")) + ".", 13, 20, C.mute) + '</td></tr>';
    if (focus) decH = '<tr><td style="padding:0 0 16px;">' + txt(esc(focus), 15, 22, C.ink, 600) + '</td></tr>' + decH;

    // projects
    var chip = { good: ["On track", C.good], warn: ["Slowing", C.warn], bad: ["Behind", C.bad], nobk: ["Check", C.warn] };
    var th = function (t, al, cl) { return '<td' + (cl ? ' class="' + cl + '"' : "") + ' align="' + (al || "right") + '" bgcolor="#FFFFFF" style="background:#FFFFFF;padding:8px 6px;border-bottom:2px solid ' + C.ink + ';">' + txt(t, 12, 16, C.mute, 600) + '</td>'; };
    var td = function (a, b, bc, cl, al) { return '<td' + (cl ? ' class="' + cl + '"' : "") + ' align="' + (al || "right") + '" valign="top" bgcolor="#FFFFFF" style="background:#FFFFFF;padding:8px 6px;border-bottom:1px solid ' + C.line + ';">' + txt('<span style="white-space:nowrap;">' + a + '</span>', 15, 20, C.ink, 600) + (b ? txt(b, 12, 16, bc || C.mute, bc ? 600 : 400, 2) : "") + '</td>'; };
    var rows = shown.slice().sort(function (a, b) { return b.sv - a.sv || b.net - a.net; }).map(function (x) {
      var s = x.s, p1 = G1[x.p] || blank(), n1 = p1.gross - p1.cx, mixOnly = !x.cut.length && x.rch != null && x.rch <= -0.05 && x.lfl.length;
      // status follows the decisions above: target first, usual month only when no target was given
      var hl = x.health === "nobk" ? chip.nobk : isBehind(x) ? (x.net / (hasT(x) ? x.bT : x.usual) < 0.6 ? chip.bad : chip.warn) : hasT(x) ? (x.bPct >= 100 ? ["Target met", C.good] : x.bPct >= 90 ? chip.good : ["Near target", C.mute]) : x.usual < 0.05 ? (x.net > 0 ? ["New bookings", C.good] : ["No bookings", C.mute]) : x.net >= x.usual * 0.9 ? ["Usual pace", C.good] : ["Near usual", C.mute];
      var rt = !x.rate ? (s.gross ? "value not entered" : "no booking") : x.cut.length ? "price cut" : x.rch == null ? "too few to compare" : Math.abs(x.rch) < 0.05 ? "steady" : (x.rch > 0 ? "▲ " : "▼ ") + Math.round(Math.abs(x.rch) * 100) + "%" + (mixOnly ? " · mix" : "");
      return '<tr>' + td(esc(x.p), hl[0], hl[1], "", "left") + td(hasT(x) ? fmt(x.bT) : '<span style="font-size:13px;color:' + C.bad + ';">No target</span>', hasT(x) ? "" : "assigned", hasT(x) ? null : C.bad) + td(sgn(x.net), hasT(x) ? Math.max(0, x.bPct) + "% of target" : x.usual >= 0.05 ? "usual " + x.usual.toFixed(1) : "none in last 3 months", hasT(x) ? stc(x.bPct) : null) + td(sgn(n1), cnt(x.net, n1, PMn).replace(" vs " + PMn, "").replace("same as " + PMn, "no change"), x.net > n1 ? C.good : x.net < n1 ? C.bad : null, "hm") + td(fcr(x.sv), s.gross && !s.av ? "not entered" : "") + td(sgn(sqft[x.p] || 0), "", null, "hm") + (sec.realisation ? td(x.rate ? "₹" + fmt(x.rate) : "–", rt, x.cut.length ? C.bad : x.rch != null && Math.abs(x.rch) >= 0.05 && !mixOnly ? (x.rch > 0 ? C.good : C.bad) : null) : "") + '</tr>';
    }).join("");
    var totR = '<tr><td valign="top" style="padding:8px 6px;background:#F4F3F3;" bgcolor="#F4F3F3">' + txt("Total", 15, 20, C.ink, 600) + '</td><td align="right" valign="top" bgcolor="#F4F3F3" style="padding:8px 6px;background:#F4F3F3;">' + (tB ? txt(fmt(tB), 15, 20, C.ink, 600) + (untagged && all && noT.length ? txt(noT.length === shown.length ? "company only" : "incl. not split", 12, 16, C.bad, 600, 2) : "") : txt("No target", 13, 20, C.bad, 600) + txt("assigned", 12, 16, C.bad, 600, 2)) + '</td><td align="right" valign="top" bgcolor="#F4F3F3" style="padding:8px 6px;background:#F4F3F3;">' + txt(sgn(net), 15, 20, C.ink, 600) + (pct != null ? txt(pct + "% of target", 12, 16, stc(pct), 600, 2) : "") + '</td><td class="hm" align="right" valign="top" bgcolor="#F4F3F3" style="padding:8px 6px;background:#F4F3F3;">' + txt(sgn(prevM.net), 15, 20, C.ink, 600) + '</td><td align="right" valign="top" bgcolor="#F4F3F3" style="padding:8px 6px;background:#F4F3F3;">' + txt('<span style="white-space:nowrap;">' + vT + '</span>', 15, 20, C.ink, 600) + '</td><td class="hm" align="right" valign="top" bgcolor="#F4F3F3" style="padding:8px 6px;background:#F4F3F3;">' + txt(sgn(sqT), 15, 20, C.ink, 600) + '</td>' + (sec.realisation ? '<td bgcolor="#F4F3F3" style="background:#F4F3F3;">&nbsp;</td>' : "") + '</tr>';
    var winB = [top ? esc(top.p) + ": " + top.net + " net bookings" : "No net bookings", top ? "Sales value " + fcr(top.sv) : "", bestCm ? "Top closing manager: <b>" + esc(proper(bestCm)) + "</b>, " + cm[bestCm] + " net" : ""].filter(Boolean);
    // direct and indirect, project by project: bookings made in the month (before cancellations) ÷ fresh walk-ins of the same channel
    var WKC = {}, UN = { d: 0, i: 0 }, TC = { d: 0, i: 0 }, BKC = {}, TB2 = { d: 0, i: 0, dv: 0, iv: 0, o: 0 };
    data.W.forEach(function (w) { var v = w[ix.vday]; if (w[ix.kind] !== 0 || v < R.from || v > R.to) return; var p = P(w), c = /channel/i.test(SRC(w)) ? "i" : "d"; if (real(p)) { if (!inScope(p)) return; (WKC[p] = WKC[p] || { d: 0, i: 0 })[c]++; TC[c]++; } else if (all) { UN[c]++; TC[c]++; } });
    BKS.forEach(function (b) { if (!real(b.p) || !inScope(b.p) || b.bday < R.from || b.bday > R.to) return; var o = BKC[b.p] = BKC[b.p] || { d: 0, i: 0, dv: 0, iv: 0, o: 0 }, c = b.cp ? "i" : b.dir ? "d" : "o"; o[c]++; TB2[c]++; if (c !== "o") { o[c + "v"] += b.av || 0; TB2[c + "v"] += b.av || 0; } });
    var ratio2 = function (b, w, ok) { return ok && w > 0 && b <= w ? (b / w * 100).toFixed(1) + "%" : "–"; };
    // one short line per project: bookings and value; the ratio only when the walk-ins carry a project
    var c1 = function (inner, al, strong, cl) { var bg = strong ? "#F4F3F3" : "#FFFFFF"; return '<td' + (cl ? ' class="' + cl + '"' : "") + ' align="' + (al || "right") + '" valign="top" bgcolor="' + bg + '" style="background:' + bg + ';padding:6px;' + (strong ? "" : 'border-bottom:1px solid ' + C.line + ';') + '">' + inner + '</td>'; };
    var chCell = function (b, w, v, ok, strong) {
      var rt = ratio2(b, w, ok), small = '<span style="font-size:12px;color:' + C.mute + ';font-weight:400;">';
      return c1(txt('<span style="white-space:nowrap;">' + (b ? fmt(b) : "–") + '</span>' + (v ? ' ' + small + '<span style="white-space:nowrap;">· ' + fcr(v) + '</span></span>' : "") + (rt !== "–" ? ' ' + small + '<span style="white-space:nowrap;">· <b>' + rt + '</b> of ' + fmt(w) + '</span></span>' : ""), 14, 20, C.ink, 600), "right", strong);
    };
    var chRows = shown.filter(function (x) { return BKC[x.p] || walkOk && WKC[x.p]; }).sort(function (a, b) { var A = BKC[a.p] || {}, B2 = BKC[b.p] || {}; return ((B2.d || 0) + (B2.i || 0)) - ((A.d || 0) + (A.i || 0)); }).map(function (x) {
      var b = BKC[x.p] || { d: 0, i: 0, dv: 0, iv: 0 }, w = WKC[x.p] || { d: 0, i: 0 }, pf = firmP[x.p] || {}, tf = Object.keys(pf).sort(function (a, z) { return pf[z] - pf[a]; })[0], sh = b.d + b.i ? Math.round(b.i / (b.d + b.i) * 100) + "%" : "–";
      return '<tr>' + c1(txt(esc(x.p), 14, 20, C.ink, 600), "left") + chCell(b.d, w.d, b.dv, walkOk) + chCell(b.i, w.i, b.iv, walkOk) + c1(txt(sh, 14, 20), "right", 0, "hm") + c1(txt(tf ? esc(tf) + ' <span style="color:' + C.mute + ';">(' + pf[tf] + ")</span>" : "–", 13, 20), "right", 0, "hm") + '</tr>';
    }).join("");
    var okAll = all || walkOk, chTbl = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>' + th("Project", "left") + th("Direct") + th("Partners") + th("Partner share", "right", "hm") + th("Top partner", "right", "hm") + '</tr>' + chRows +
      '<tr>' + c1(txt("Total", 14, 20, C.ink, 600), "left", 1) + chCell(TB2.d, TC.d, TB2.dv, okAll, 1) + chCell(TB2.i, TC.i, TB2.iv, okAll, 1) + c1(txt(TB2.d + TB2.i ? Math.round(TB2.i / (TB2.d + TB2.i) * 100) + "%" : "–", 14, 20, C.ink, 600), "right", 1, "hm") + c1(txt(firms.length ? "Top 3: " + top3 + " of " + nCP : "–", 13, 20, C.mute), "right", 1, "hm") + '</tr></table>';
    var chNote = (walkOk ? "" : "Project ratios are left out: " + (all ? fmt(T.noProj) + " of " + fmt(T.fresh) : fmt(T.noProj)) + " walk-ins have no project. ") + (TB2.o ? TB2.o + " booking" + (TB2.o > 1 ? "s have" : " has") + " no Source Type and " + (TB2.o > 1 ? "are" : "is") + " in neither column. " : "");
    var card1 = function (inner) { return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="cd" bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ' + C.line + ';padding:16px 20px;">' + inner + '</td></tr></table>'; };
    var gapRow = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="8" style="font-size:0;line-height:8px;mso-line-height-rule:exactly;">&nbsp;</td></tr></table>';
    var cxL = Object.keys(cxBy).sort(function (a, b) { return cxBy[b] - cxBy[a]; }).map(function (p) { var g = G[p] || blank(); return esc(p) + " " + cxBy[p] + (g.avx ? " (" + fcr(g.avx) + ")" : " (value not entered)"); }).join(", ");
    var boxes = card1(h2("Direct and partner bookings by project", M + " bookings before cancellations, with value" + (okAll ? ". % = bookings ÷ " + M + " fresh walk-ins of the same channel" : "") + ".") + gapRow + chTbl + (chNote ? txt(esc(chNote), 12, 18, C.mute, 400, 6) : "") +
      txt("<b>Cancellations:</b> " + (T.cx ? T.cx + " in " + M + (T.avx ? ", " + fcr(T.avx) : "") + ". " + cxL + "." : "none in " + M + "."), 14, 20, C.ink, 400, 10));
    var conf = []; if (noProjShare >= 0.1) conf.push((all ? fmt(T.noProj) + " of " + fmt(T.fresh) + " walk-ins have" : fmt(T.noProj) + " of the company’s walk-ins have") + " no project, so for each project it is not known whether walk-ins or conversion fell"); if (noVal) conf.push(noVal + " booking" + (noVal > 1 ? "s have" : " has") + " no agreement value, so sales value is understated");
    if (noT.length) conf.push("no " + M + " booking target was given for " + noT.map(function (x) { return x.p; }).join(", ") + (tB && untagged && all ? " (" + fmt(tB) + " given for the company)" : "") + ", so " + (noT.length > 1 ? "they are" : "it is") + " compared with the usual month");
    if (noSt.length) conf.push("the Inventory tab is incomplete for " + noSt.map(function (x) { return x.p; }).join(", ") + ", so unsold flats are not used there"); 
    var url = opt.url || "https://sales-dashboard-pi-one.vercel.app", scopeTxt = all ? "All projects" : Object.keys(want).join(", ");
    var sec1 = function (inner, pad) { return '<tr><td class="px" style="padding:' + (pad || "24px 32px 0") + ';">' + inner + '</td></tr>'; }, tb = function (inner) { return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">' + inner + '</table>'; };
    var html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(subject) + '</title><style>table{border-collapse:collapse}@media (max-width:640px){.px{padding-left:12px!important;padding-right:12px!important}.k{display:inline-block!important;width:50%!important;box-sizing:border-box}.col{display:block!important;width:auto!important}.hm,.gap{display:none!important}.pt td{padding-left:3px!important;padding-right:3px!important}.pt td p{font-size:12px!important}.cd{padding-left:12px!important;padding-right:12px!important}.hd{font-size:22px!important;line-height:30px!important}}</style></head>' +
      '<body style="margin:0;padding:0;background:#F6F6F6;"><span style="display:none;max-height:0;overflow:hidden;opacity:0;">' + esc(pre) + '</span><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F6F6F6" style="background:#F6F6F6;border-collapse:collapse;' + FN + '">' +
      '<tr><td class="px" bgcolor="#1C1A1B" style="background:#1C1A1B;padding:28px 40px;border-bottom:4px solid #B3261E;">' + txt("Raghav Realty · Monthly sales report · " + esc(scopeTxt), 14, 20, "#CFCBCA", 600) + '<p class="hd" style="margin:8px 0 0;font-size:28px;line-height:36px;mso-line-height-rule:exactly;color:#FFFFFF;font-weight:600;' + FN + '">' + head + '</p>' + txt(esc(sub2), 16, 24, "#E5E3E2", 400, 8) + '</td></tr>' +
      sec1(tb(tiles), "16px 24px 0") +
      (sec.decisions || sec.cards ? sec1(tb((sec.decisions ? '<tr><td colspan="2" valign="top" style="padding:8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ' + C.line + ';padding:20px 20px 8px;">' + h2("Decisions for you", "Biggest business impact first: what happened, why, and the choice to make") + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="12" style="font-size:0;line-height:12px;mso-line-height-rule:exactly;">&nbsp;</td></tr>' + decH + '</table></td></tr></table></td></tr>' : "") + (sec.cards ? '<tr><td class="col" width="65%" valign="top" style="padding:8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="cd" bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ' + C.line + ';padding:20px;">' + h2("Last 6 months", "Sales value in ₹ Cr, with net bookings" + (tB ? " against target" : "") + " below") + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="16" style="font-size:0;line-height:16px;mso-line-height-rule:exactly;">&nbsp;</td></tr><tr><td>' + bars + '</td></tr></table></td></tr></table></td><td class="col" width="35%" valign="top" style="padding:8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ' + C.line + ';border-left:4px solid ' + C.good + ';padding:16px 20px;">' + txt("Win of the month", 14, 20, C.mute, 600) + winB.map(function (l, n) { return n ? txt(l, 14, 20, "#3A3737", 400, 4) : txt(l, 18, 24, C.ink, 600, 4); }).join("") + '</td></tr></table></td></tr>' : "")), "8px 24px 0") : "") +
      sec1('<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="cd" bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ' + C.line + ';padding:20px;">' + h2("Projects", "Biggest sales value first. Bookings are net of cancellations" + (sec.realisation ? "; ₹ per sq ft is after 2.25% brokerage, compared with the last 3 months." : ".")) + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="12" style="font-size:0;line-height:12px;mso-line-height-rule:exactly;">&nbsp;</td></tr></table><table class="pt" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;"><tr>' + th("Project", "left") + th("Target") + th("Net bookings") + th(PMn, "right", "hm") + th("Sales value") + th("Sq ft sold", "right", "hm") + (sec.realisation ? th("₹ per sq ft") : "") + '</tr>' + rows + totR + '</table>' + (idle.length ? txt("No activity: " + idle.map(function (x) { return esc(x.p); }).join(", "), 12, 18, C.mute, 400, 8) : "") + '</td></tr></table>', "16px 32px 0") +
      (sec.channel ? sec1(boxes, "16px 32px 0") : "") +
      (conf.length ? sec1(txt("<b>Data confidence:</b> " + esc(conf.join("; ")) + ".", 13, 20, C.mute), "16px 40px 0") : "") +
      '<tr><td class="px" align="center" style="padding:24px 32px 8px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#B3261E" style="background:#B3261E;border-radius:8px;"><a href="' + esc(url) + '" style="display:inline-block;padding:14px 32px;color:#FFFFFF;text-decoration:none;font-size:16px;line-height:20px;font-weight:600;' + FN + '">Open the Control Tower</a></td></tr></table></td></tr>' +
      sec1(txt("Net bookings = bookings minus cancellations in " + M + ". Impact figures are estimates from average values; a project’s gap is part of the company’s shortfall, so don’t add them. A missed booking is valued at the project’s own average of the last 3 months. Unsold flats are as the Inventory tab stands when this email is built. Causes come from fixed rules on these figures. Target = booking target given for that project and month (Closing Targets, column C). “Usual” = average of the 3 months before, used only when no target was assigned. Automated email from noreply@raghavgroup.in; replies are not read.", 12, 18, "#8A8787"), "8px 40px 32px") + '</table></body></html>';
    return { subject: subject, html: html, preheader: pre, period: ym, stats: { net: net, target: tB, fresh: T.fresh, walkTarget: tW, projects: list.length, decisions: dec.length } };
  }

  var api = { build: build, lastFullMonth: lastFullMonth };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SalesReport = api;
})(typeof self !== "undefined" ? self : this);
