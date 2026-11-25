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
    var sqft = {}, sqT = 0, noVal = 0, cm = {}, firm = {}, cxBy = {}, svCP = 0, svD = 0, nCP = 0, nD = 0, valued = 0;
    BKS.forEach(function (b) {
      if (!real(b.p) || !inScope(b.p)) return;
      if (b.bday >= R.from && b.bday <= R.to) {
        sqft[b.p] = (sqft[b.p] || 0) + (b.ca > 0 ? b.ca : 0); sqT += b.ca > 0 ? b.ca : 0; if (!(b.av > 0)) noVal++; else valued++;
        if (b.cm) cm[b.cm] = (cm[b.cm] || 0) + 1; if (b.cp) { nCP++; svCP += b.av || 0; if (b.firm) firm[b.firm] = (firm[b.firm] || 0) + 1; } else if (b.dir) { nD++; svD += b.av || 0; }
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

    // decisions: issue, rupee impact, action, owner. Data-entry problems are not here.
    dec = [];
    if (short && ticket) dec.push({ k: short * ticket + 1e12, lvl: net / tB < 0.8 ? "bad" : "warn", t: fmt(short) + " booking" + (short > 1 ? "s" : "") + " short of the " + M + " target", i: "About " + fcr(short * ticket) + " at this month’s average ticket of " + fcr(ticket), a: "Agree a " + NEXT + " catch-up number for each project", o: "Sales head" });
    shown.forEach(function (x) { var base = x.bT || x.usual, gap = base - x.net, tk = x.s.gross && x.s.av ? x.s.av / x.s.gross : ticket; if (gap >= 2 && x.health !== "good") dec.push({ k: gap * tk, lvl: x.health === "bad" ? "bad" : "warn", t: x.p + ": " + sgn(x.net) + " net booking" + (x.net === 1 ? "" : "s") + " against " + (x.bT ? "a target of " + fmt(x.bT) : "a usual " + x.usual.toFixed(1)), i: "About " + fcr(gap * tk) + " below " + (x.bT ? "target" : "its usual month"), a: "Review price, offers and the pipeline of open customers", o: "Project sales lead" }); });
    if (T.cx >= 2) dec.push({ k: T.avx, lvl: T.cx / Math.max(1, T.gross) >= 0.25 ? "bad" : "warn", t: T.cx + " cancellations, " + Math.round(T.cx / Math.max(1, T.gross) * 100) + "% of bookings", i: (T.avx ? fcr(T.avx) + " cancelled" : "Value not entered") + (Object.keys(cxBy).length ? ": " + Object.keys(cxBy).sort(function (a, b) { return cxBy[b] - cxBy[a]; }).map(function (p) { return p + " " + cxBy[p]; }).join(", ") : ""), a: "Call each buyer; record the reason and the refund or rebooking status", o: "CRM head" });
    shown.forEach(function (x) { if (!sec.realisation || !x.cut.length) return; var l = x.cut[0], loss = (l.was - l.now) * x.s.cc[l.c].ca; dec.push({ k: loss * 3, lvl: "bad", t: x.p + " " + l.c + " sold " + Math.round(-l.ch * 100) + "% cheaper per sq ft", i: "₹" + fmt(l.was) + " → ₹" + fmt(l.now) + ", about " + fcr(loss) + " on " + l.n + " flats", a: "Confirm which discounts were given and who approved them", o: "Sales head" }); });
    if (firms.length && T.gross >= 8 && firm[firms[0]] / T.gross >= 0.25) dec.push({ k: 1, lvl: "warn", t: firms[0] + " brought " + firm[firms[0]] + " of " + T.gross + " bookings", i: "High dependence on one channel partner", a: "Activate 2 to 3 more firms in " + NEXT, o: "Sourcing head" });
    dec.sort(function (a, b) { return b.k - a.k; }); dec = dec.slice(0, 3);

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
      tile(stc(pct), "Net bookings", sgn(net), tB ? "of " + fmt(tB) : "", pct != null ? pct + "% of target" : "no target given", stc(pct), fmt(T.gross) + " booked, " + T.cx + " cancelled · " + cnt(net, prevM.net, PMn)) +
      tile(stc(wpct), "Fresh walk-ins", fmt(T.fresh), tW ? "of " + fmt(tW) : "", wpct != null ? wpct + "% of target" : "no target given", stc(wpct), chT(chg(T.fresh, prevM.fresh), PMn)) +
      tile(okC && c3 != null ? (cons >= c3 - 0.5 ? C.good : C.warn) : "#8A8787", "Walk-in to booking", okC ? cons.toFixed(1) + "%" : "–", "", okC && c3 != null ? (Math.abs(cons - c3) < 0.5 ? "level" : (cons > c3 ? "▲ " : "▼ ") + Math.abs(cons - c3).toFixed(1) + " pts") + " vs 3-month average" : "", okC && c3 != null ? (cons - c3 >= 0.5 ? C.good : cons - c3 <= -0.5 ? C.bad : C.mute) : C.mute, fmt(net) + " of " + fmt(T.fresh) + " walk-ins") + '</tr>';

    // six-month bars (plain table cells, so every mail app draws them)
    var mx = Math.max.apply(null, hist.map(function (x) { return Math.max(x.sv, 1); }));
    var bars = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>' + hist.map(function (x, n) { var hgt = Math.max(4, Math.round(Math.max(0, x.sv) / mx * 120)), col = n === 5 ? "#B3261E" : "#CFCBCA"; return '<td align="center" valign="bottom" height="150" style="padding:0 4px;">' + txt('<span style="white-space:nowrap;">' + (x.sv ? (x.sv / 1e7).toFixed(1) : "0") + '</span>', 13, 16, n === 5 ? "#B3261E" : C.mute, 600) + '<table role="presentation" width="44" cellpadding="0" cellspacing="0" align="center" style="border-collapse:collapse;"><tr><td height="' + hgt + '" bgcolor="' + col + '" style="height:' + hgt + 'px;background:' + col + ';font-size:0;line-height:' + hgt + 'px;mso-line-height-rule:exactly;">&nbsp;</td></tr></table></td>'; }).join("") + '</tr><tr>' + hist.map(function (x, n) { return '<td align="center" style="padding:8px 2px 0;border-top:1px solid ' + C.line + ';">' + txt(x.m, 13, 18, n === 5 ? C.ink : C.mute, n === 5 ? 600 : 400) + txt(sgn(x.net) + (x.t ? " of " + fmt(x.t) : ""), 12, 16, C.mute) + '</td>'; }).join("") + '</tr></table>';

    var decH = dec.length ? dec.map(function (x, n) { var c = x.lvl === "bad" ? C.bad : C.warn; return '<tr><td style="padding:0 0 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td width="4" bgcolor="' + c + '" style="background:' + c + ';font-size:0;">&nbsp;</td><td bgcolor="#FAF9F9" style="background:#FAF9F9;padding:12px 16px;">' + txt((n + 1) + ". " + esc(x.t), 16, 22, C.ink, 600) + txt(esc(x.i), 14, 20, c, 600, 2) + txt("<b>Action:</b> " + esc(x.a), 14, 20, "#3A3737", 400, 4) + txt("<b>Owner:</b> " + esc(x.o), 13, 18, C.mute, 400, 2) + '</td></tr></table></td></tr>'; }).join("") : '<tr><td bgcolor="#E8F5EC" style="background:#E8F5EC;padding:16px;">' + txt("Nothing needs a decision this month.", 14, 20, C.good, 600) + '</td></tr>';

    // projects
    var chip = { good: ["On track", C.good], warn: ["Slowing", C.warn], bad: ["Behind", C.bad], nobk: ["Check", C.warn] };
    var th = function (t, al, cl) { return '<td' + (cl ? ' class="' + cl + '"' : "") + ' align="' + (al || "right") + '" style="padding:8px 6px;border-bottom:2px solid ' + C.ink + ';">' + txt(t, 12, 16, C.mute, 600) + '</td>'; };
    var td = function (a, b, bc, cl, al) { return '<td' + (cl ? ' class="' + cl + '"' : "") + ' align="' + (al || "right") + '" valign="top" style="padding:12px 6px;border-bottom:1px solid ' + C.line + ';">' + txt('<span style="white-space:nowrap;">' + a + '</span>', 15, 20, C.ink, 600) + (b ? txt(b, 12, 16, bc || C.mute, bc ? 600 : 400, 2) : "") + '</td>'; };
    var rows = shown.slice().sort(function (a, b) { return b.sv - a.sv || b.net - a.net; }).map(function (x) {
      var s = x.s, p1 = G1[x.p] || blank(), n1 = p1.gross - p1.cx, mixOnly = !x.cut.length && x.rch != null && x.rch <= -0.05 && x.lfl.length;
      // a gap of under 2 bookings is too small to call a project behind
      var base = x.bT || x.usual, hl = (x.health === "bad" || x.health === "warn") && base - x.net < 2 ? ["Near usual", C.mute] : chip[x.health];
      var rt = !x.rate ? (s.gross ? "value not entered" : "no booking") : x.cut.length ? "price cut" : x.rch == null ? "too few to compare" : Math.abs(x.rch) < 0.05 ? "steady" : (x.rch > 0 ? "▲ " : "▼ ") + Math.round(Math.abs(x.rch) * 100) + "%" + (mixOnly ? " · mix" : "");
      return '<tr>' + td(esc(x.p), hl[0], hl[1], "", "left") + td(sgn(x.net) + (x.bT ? ' <span style="font-weight:400;color:' + C.mute + ';">of ' + fmt(x.bT) + '</span>' : ""), x.bT ? Math.max(0, x.bPct) + "% of target" : (x.usual >= 0.05 ? "usual " + x.usual.toFixed(1) : "none in the last 3 months")) + td(sgn(n1), cnt(x.net, n1, PMn).replace(" vs " + PMn, "").replace("same as " + PMn, "no change"), x.net > n1 ? C.good : x.net < n1 ? C.bad : null, "hm") + td(fcr(x.sv), s.gross && !s.av ? "not entered" : "") + td(sgn(sqft[x.p] || 0), "", null, "hm") + (sec.realisation ? td(x.rate ? "₹" + fmt(x.rate) : "–", rt, x.cut.length ? C.bad : x.rch != null && Math.abs(x.rch) >= 0.05 && !mixOnly ? (x.rch > 0 ? C.good : C.bad) : null) : "") + '</tr>';
    }).join("");
    var totR = '<tr><td style="padding:12px 6px;background:#F4F3F3;" bgcolor="#F4F3F3">' + txt("Total", 15, 20, C.ink, 600) + '</td><td align="right" bgcolor="#F4F3F3" style="padding:12px 6px;background:#F4F3F3;">' + txt(sgn(net) + (tB ? " of " + fmt(tB) : ""), 15, 20, C.ink, 600) + '</td><td class="hm" align="right" bgcolor="#F4F3F3" style="padding:12px 6px;background:#F4F3F3;">' + txt(sgn(prevM.net), 15, 20, C.ink, 600) + '</td><td align="right" bgcolor="#F4F3F3" style="padding:12px 6px;background:#F4F3F3;">' + txt('<span style="white-space:nowrap;">' + vT + '</span>', 15, 20, C.ink, 600) + '</td><td class="hm" align="right" bgcolor="#F4F3F3" style="padding:12px 6px;background:#F4F3F3;">' + txt(sgn(sqT), 15, 20, C.ink, 600) + '</td>' + (sec.realisation ? '<td bgcolor="#F4F3F3" style="background:#F4F3F3;">&nbsp;</td>' : "") + '</tr>';
    var box = function (title, lines) { return '<td class="col" width="50%" valign="top" style="padding:8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ' + C.line + ';padding:16px;">' + txt(title, 14, 20, C.mute, 600) + lines.map(function (l, n) { return n ? txt(l, 14, 20, "#3A3737", 400, 4) : txt(l, 18, 24, C.ink, 600, 4); }).join("") + '</td></tr></table></td>'; };
    var chTot = nCP + nD, dr = T.dCa ? T.dNav / T.dCa : null, cr = T.cpCa ? T.cpNav / T.cpCa : null;
    var winB = [top ? esc(top.p) + ": " + top.net + " net bookings" : "No net bookings", top ? "Sales value " + fcr(top.sv) : "", bestCm ? "Top closing manager: <b>" + esc(proper(bestCm)) + "</b>, " + cm[bestCm] + " net" : ""].filter(Boolean);
    var boxes = '<tr>' + box("Channel", [chTot ? Math.round(nCP / chTot * 100) + "% through channel partners" : "Channel not entered", "Direct " + nD + " (" + fcr(svD) + ") · Partners " + nCP + " (" + fcr(svCP) + ")", "Estimated brokerage " + fcr(svCP * BRK) + " at 2.25%", firms.length ? "Top 3 firms: " + top3 + " of " + nCP + " (" + esc(firms.slice(0, 3).join(", ")) + ")" : ""].filter(Boolean)) +
      box("Cancellations", [T.cx ? T.cx + " cancelled, " + (T.avx ? fcr(T.avx) : "value not entered") : "None this month", T.cx ? Math.round(T.cx / Math.max(1, T.gross) * 100) + "% of " + T.gross + " bookings" : "", Object.keys(cxBy).length ? "By project: " + Object.keys(cxBy).map(function (p) { return esc(p) + " " + cxBy[p]; }).join(", ") : ""].filter(Boolean)) + '</tr>';
    var conf = []; if (noProjShare >= 0.1) conf.push(fmt(T.noProj) + " of " + fmt(T.fresh) + " walk-ins have no project, so walk-ins are not shown by project"); if (noVal) conf.push(noVal + " booking" + (noVal > 1 ? "s have" : " has") + " no agreement value, so sales value is understated"); if (shown.some(function (x) { return !x.bT; })) conf.push("targets are not set for every project, so those are compared with their usual month");
    var url = opt.url || "https://sales-dashboard-pi-one.vercel.app", scopeTxt = all ? "All projects" : Object.keys(want).join(", ");
    var sec1 = function (inner, pad) { return '<tr><td class="px" style="padding:' + (pad || "24px 32px 0") + ';">' + inner + '</td></tr>'; }, tb = function (inner) { return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">' + inner + '</table>'; };
    var html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(subject) + '</title><style>table{border-collapse:collapse}@media (max-width:640px){.px{padding-left:12px!important;padding-right:12px!important}.k{display:inline-block!important;width:50%!important;box-sizing:border-box}.col{display:block!important;width:auto!important}.hm{display:none!important}.hd{font-size:22px!important;line-height:30px!important}}</style></head>' +
      '<body style="margin:0;padding:0;background:#F6F6F6;"><span style="display:none;max-height:0;overflow:hidden;opacity:0;">' + esc(pre) + '</span><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F6F6F6" style="background:#F6F6F6;border-collapse:collapse;' + FN + '">' +
      '<tr><td class="px" bgcolor="#1C1A1B" style="background:#1C1A1B;padding:28px 40px;border-bottom:4px solid #B3261E;">' + txt("Raghav Realty · Monthly sales report · " + esc(scopeTxt), 14, 20, "#CFCBCA", 600) + '<p class="hd" style="margin:8px 0 0;font-size:28px;line-height:36px;mso-line-height-rule:exactly;color:#FFFFFF;font-weight:600;' + FN + '">' + head + '</p>' + txt(esc(sub2), 16, 24, "#E5E3E2", 400, 8) + '</td></tr>' +
      sec1(tb(tiles), "16px 24px 0") +
      (sec.decisions || sec.cards ? sec1(tb('<tr>' + (sec.decisions ? '<td class="col" width="' + (sec.cards ? 55 : 100) + '%" valign="top" style="padding:8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ' + C.line + ';padding:20px 20px 8px;">' + h2("Decisions for you", "Issue, what it costs, and who should act") + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">' + decH + '</table></td></tr></table></td>' : "") + (sec.cards ? '<td class="col" width="' + (sec.decisions ? 45 : 100) + '%" valign="top" style="padding:8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ' + C.line + ';padding:20px;">' + h2("Last 6 months", "Sales value in ₹ Cr, with net bookings" + (tB ? " against target" : "") + " below") + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr><td>' + bars + '</td></tr></table></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="16" style="font-size:0;line-height:16px;">&nbsp;</td></tr><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ' + C.line + ';border-left:4px solid ' + C.good + ';padding:16px 20px;">' + txt("Win of the month", 14, 20, C.mute, 600) + winB.map(function (l, n) { return n ? txt(l, 14, 20, "#3A3737", 400, 4) : txt(l, 18, 24, C.ink, 600, 4); }).join("") + '</td></tr></table></td>' : "") + '</tr>'), "8px 24px 0") : "") +
      sec1('<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid ' + C.line + ';padding:20px;">' + h2("Projects", "Biggest sales value first. Bookings are net of cancellations" + (sec.realisation ? "; ₹ per sq ft is after 2.25% brokerage, compared with the last 3 months." : ".")) + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:collapse;"><tr>' + th("Project", "left") + th("Net bookings") + th(PMn, "right", "hm") + th("Sales value") + th("Sq ft sold", "right", "hm") + (sec.realisation ? th("₹ per sq ft") : "") + '</tr>' + rows + totR + '</table>' + (idle.length ? txt("No activity: " + idle.map(function (x) { return esc(x.p); }).join(", "), 12, 18, C.mute, 400, 8) : "") + '</td></tr></table>', "16px 32px 0") +
      (sec.channel ? sec1(tb(boxes), "8px 24px 0") : "") +
      (conf.length ? sec1(txt("<b>Data confidence:</b> " + esc(conf.join("; ")) + ".", 13, 20, C.mute), "16px 40px 0") : "") +
      '<tr><td class="px" align="center" style="padding:24px 32px 8px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#B3261E" style="background:#B3261E;border-radius:8px;"><a href="' + esc(url) + '" style="display:inline-block;padding:14px 32px;color:#FFFFFF;text-decoration:none;font-size:16px;line-height:20px;font-weight:600;' + FN + '">Open the Control Tower</a></td></tr></table></td></tr>' +
      sec1(txt("Net bookings = bookings minus cancellations in " + M + ". Impact figures are estimates from average values; a project’s gap is part of the company’s shortfall, so don’t add them. “Usual” = average of the 3 months before. Automated email from noreply@raghavgroup.in; replies are not read.", 12, 18, "#8A8787"), "8px 40px 32px") + '</table></body></html>';
    return { subject: subject, html: html, preheader: pre, period: ym, stats: { net: net, target: tB, fresh: T.fresh, walkTarget: tW, projects: list.length, decisions: dec.length } };
  }

  var api = { build: build, lastFullMonth: lastFullMonth };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SalesReport = api;
})(typeof self !== "undefined" ? self : this);
