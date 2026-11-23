/* Builds the monthly management email from the cleaned dataset (same rules as the dashboard).
   build(data, { ym:"2026-10", projects:["*"] | ["Jade",...], sections:{decisions,cards,channel,realisation}, url })
   -> { subject, html, preheader, period, stats }
   Layout: headline, 4 company numbers, up to 3 decisions, one table with a row per project
   (bookings vs that project's target, walk-ins vs target, ₹/sq ft vs its last 3 months, status),
   then a card with an "Ask" line only for projects that need attention. Quiet projects on one line.
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
        var w = b[0] >= 0 ? data.W[b[0]] : null, cp = !!b[9]; // Booking details column R (CP firm): filled = through a CP, blank = direct
        BKS.push({ p: b[1] || (w ? P(w) : ""), bday: b[2], cx: b[3], cday: b[4], av: b[5], ca: b[6], cp: cp, cfg: b.length > 12 ? b[12] || "" : "" });
      });
    } else {
      data.W.forEach(function (r) { if (r[ix.bk]) BKS.push({ p: P(r), bday: r[ix.bday], cx: r[ix.cx], cday: r[ix.cday], av: 0, ca: 0, cp: /channel/i.test(SRC(r)), cfg: "" }); });
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
              if (b.cp) { s.cpNav += n; s.cpCa += b.ca; } else { s.dNav += n; s.dCa += b.ca; }
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

    // decisions: up to 3 across all projects, most serious first; the data fix keeps a place while it is needed
    var dec = [];
    shown.forEach(function (x) { var a = x.ask[0]; if (a && a.w <= 3) dec.push({ w: a.w, lvl: a.w === 1 ? "bad" : "warn", t: x.p + ": " + a.f.charAt(0).toLowerCase() + a.f.slice(1), d: a.q }); });
    dec.sort(function (a, b) { return a.w - b.w; });
    var fix = all && T.fresh >= 20 && !walkOk ? { lvl: "warn", t: "Make “Project” mandatory in the Walk-in sheet", d: fmt(T.noProj) + " of " + fmt(T.fresh) + " walk-ins in " + M + " have no project, so walk-ins per project can't be judged against target." } : null;
    dec = dec.slice(0, fix ? 2 : 3); if (fix) dec.push(fix);

    // headline
    var top = shown.filter(function (x) { return x.net > 0; }).sort(function (a, b) { return b.net - a.net; })[0];
    var weak = shown.filter(function (x) { return x.health === "bad"; }).map(function (x) { return x.p; });
    var y = "<span style=\"color:#FCD34D;\">";
    var head = M + " " + R.y + ": " + (wpct != null ? (wpct >= 100 ? "walk-ins beat target, " : "walk-ins at " + wpct + "%, ") : "") + (pct != null ? "bookings reached " + y + pct + "%</span>" + (wpct == null ? " of target" : "") : fmt(net) + " net bookings");
    var sub2 = (top ? (top.net === net ? "All " + net + " net bookings came from " + top.p + "." : top.p + " led with " + top.net + " net bookings.") : "No net bookings this month.") + (weak.length ? " " + weak.slice(0, 3).join(", ") + (weak.length > 3 ? " and " + (weak.length - 3) + " more" : "") + (weak.length === 1 ? " needs attention." : " need attention.") : "");
    var subject = M + " sales: " + fmt(net) + " net booking" + (net === 1 ? "" : "s") + (pct != null ? ", " + pct + "% of target" : "") + (dec.length ? " · " + dec.length + " decision" + (dec.length > 1 ? "s" : "") + " for you" : "");
    var pre = (wpct != null ? "Walk-ins " + wpct + "% of target. " : "") + (pct != null ? "Bookings " + pct + "% of target. " : "") + (weak.length ? weak.slice(0, 3).join(", ") + (weak.length === 1 ? " needs attention." : " need attention.") : "No project needs attention.");

    // ---------- HTML (email-safe: tables, inline styles, no images or scripts) ----------
    var css = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2A2324;";
    var C = { good: "#15803D", warn: "#B45309", bad: "#B91C1C", mute: "#6E6466", line: "#ECE4E2" };
    var pc = function (v) { return v == null ? C.mute : v >= 100 ? C.good : v >= 80 ? C.warn : C.bad; };
    // each tile is one coloured table cell (bgcolor too), so Outlook paints it as one solid block, not a stripe per line
    var kpi = function (bg, label, big, small, note, nc) { return '<td class="k" width="50%" style="padding:6px;" valign="top"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="' + bg + '" style="background:' + bg + ';border-radius:10px;padding:12px;mso-line-height-rule:exactly;"><p style="margin:0;font-size:11.5px;line-height:16px;color:#6E6466;font-weight:600;">' + label + '</p><p style="margin:2px 0 0;font-size:24px;line-height:30px;font-weight:800;">' + big + (small ? '<span style="font-size:13px;color:#6E6466;font-weight:600;"> / ' + small + '</span>' : "") + '</p><p style="margin:2px 0 0;font-size:11.5px;line-height:16px;color:' + (nc || "#6E6466") + ';font-weight:' + (nc ? 700 : 400) + ';">' + note + '</p></td></tr></table></td>'; };
    var cons = T.fresh ? net / T.fresh * 100 : null;
    // the tiles add up every project in this email: say so above them, and say where the targets come from
    var tot = all ? "All projects together" : Object.keys(want).length === 1 ? Object.keys(want)[0] : Object.keys(want).join(" + ") + " together";
    var tnote = !(tB || tW) ? "No target given for " + M + "." : all ? "Targets = every manager’s " + M + " target in the Closing and Sourcing Targets sheets" + (untagged && Object.keys(PT).length ? ", including rows not yet tagged to a project, so the project targets below won’t add up to these." : ".") : "Targets = target rows tagged with " + (Object.keys(want).length === 1 ? "this project" : "these projects") + " for " + M + ".";
    var kpis = '<tr><td class="px" style="padding:20px 26px 0;"><p style="margin:0;font-size:12px;line-height:16px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6E6466;">' + esc(tot) + " · " + M + '</p></td></tr>' +
      '<tr><td class="px" style="padding:6px 20px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      kpi(pct != null && pct < 80 ? "#FDECEA" : "#E8F7EE", "Net bookings", sgn(net), tB ? fmt(tB) : "", pct != null ? pct + "% of target" : "no target given", pct == null ? null : pc(pct)) +
      kpi("#F7F1EF", "Sales value", fcr(T.av - T.avx), "", "excl. GST &amp; stamp") + '</tr><tr>' +
      kpi(wpct != null && wpct < 80 ? "#FDECEA" : "#E8F7EE", "Fresh walk-ins", fmt(T.fresh), tW ? fmt(tW) : "", wpct != null ? wpct + "% of target" : "no target given", wpct == null ? null : pc(wpct)) +
      kpi("#F7F1EF", "Walk-in → booking", cons == null || cons > 100 || cons < 0 ? "–" : cons.toFixed(1) + "%", "", !T.fresh ? "no walk-ins" : cons > 100 || cons < 0 ? "walk-ins missing their project" : fmt(net) + " of " + fmt(T.fresh)) + '</tr></table></td></tr>' +
      '<tr><td class="px" style="padding:2px 26px 4px;"><p style="margin:0;font-size:11px;line-height:15px;color:#8C8183;">' + esc(tnote) + ' Each project’s own numbers are in the Projects table below.</p></td></tr>';

    var decH = sec.decisions ? '<tr><td class="px" style="padding:14px 28px 4px;"><div style="font-size:16px;font-weight:700;">Decisions for you</div></td></tr><tr><td class="px" style="padding:6px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
      (dec.length ? dec.map(function (x, i) { var c = x.lvl === "bad" ? ["#B91C1C", "#FDF3F2"] : ["#B45309", "#FEF8EC"]; return (i ? '<tr><td height="8"></td></tr>' : "") + '<tr><td bgcolor="' + c[1] + '" style="border-left:4px solid ' + c[0] + ';background:' + c[1] + ';border-radius:0 10px 10px 0;padding:11px 14px;"><div style="font-size:14.5px;font-weight:700;">' + (i + 1) + ". " + esc(x.t) + '</div><div style="font-size:13px;line-height:1.5;color:#4D4446;margin-top:2px;">' + esc(x.d) + '</div></td></tr>'; }).join("")
        : '<tr><td bgcolor="#E8F7EE" style="background:#E8F7EE;border-radius:10px;padding:12px 14px;font-size:13.5px;color:#15803D;font-weight:600;">Nothing needs a decision this month.</td></tr>') + '</table></td></tr>' : "";

    // project table
    var chip = { good: ["On track", "#DCFCE7", C.good], warn: ["Slowing", "#FEF3C7", C.warn], bad: ["Behind", "#FEE2E2", C.bad], nobk: ["Check", "#FEF3C7", C.warn] };
    var th = function (t, al) { return '<td align="' + (al || "right") + '" style="font-size:11px;color:#6E6466;font-weight:700;padding:0 6px 6px;border-bottom:1px solid ' + C.line + ';">' + t + '</td>'; };
    var cell = function (big, small, sc) { return '<td align="right" valign="top" style="padding:9px 6px;border-bottom:1px solid ' + C.line + ';white-space:nowrap;"><div style="font-size:14px;font-weight:700;">' + big + '</div><div style="font-size:11px;color:' + (sc || C.mute) + ';font-weight:' + (sc ? 700 : 400) + ';">' + small + '</div></td>'; };
    var anyMissT = false, rows = shown.map(function (x) {
      var c = chip[x.health], s = x.s;
      if (!x.bT || !x.wT) anyMissT = true;
      var bk = x.bT ? cell(sgn(x.net) + '<span style="font-size:11.5px;color:#6E6466;font-weight:600;"> / ' + fmt(x.bT) + '</span>', Math.max(0, x.bPct) + "%", pc(x.bPct)) : cell(sgn(x.net), "no target");
      var wk = x.wT ? cell(fmt(s.fresh) + '<span style="font-size:11.5px;color:#6E6466;font-weight:600;"> / ' + fmt(x.wT) + '</span>', x.wPct + "%", walkOk ? pc(x.wPct) : null) : cell(fmt(s.fresh), "no target");
      var rt = "";
      if (sec.realisation) {
        var ch = x.rch == null ? (x.rate ? (x.nR < 3 || x.pnR < 3 ? "too few to compare" : "–") : "no booking") : Math.abs(x.rch) < 0.05 ? "steady" : (x.rch > 0 ? "▲ " : "▼ ") + Math.round(Math.abs(x.rch) * 100) + "%";
        // tag: "price" when a configuration sold cheaper, "mix" when the drop is only the mix of flats sold
        var mixOnly = !x.cut.length && x.rch != null && x.rch <= -0.05 && x.lfl.length;
        if (x.cut.length) ch = (x.rch != null && Math.abs(x.rch) >= 0.05 ? ch + " · " : "") + "price cut";
        else if (mixOnly) ch += " · mix";
        rt = cell(x.rate ? "₹" + fmt(x.rate) : "–", ch, x.cut.length ? C.bad : mixOnly ? null : x.rch != null && Math.abs(x.rch) >= 0.05 ? (x.rch > 0 ? C.good : C.bad) : null);
      }
      return '<tr><td valign="top" style="padding:9px 6px 9px 0;border-bottom:1px solid ' + C.line + ';"><div style="font-size:14px;font-weight:700;">' + esc(x.p) + '</div><span style="display:inline-block;margin-top:3px;background:' + c[1] + ';color:' + c[2] + ';font-weight:700;font-size:10.5px;border-radius:999px;padding:1px 8px;">' + c[0] + '</span></td>' + bk + wk + rt + '</tr>';
    }).join("");
    var tbl = shown.length ? '<tr><td class="px" style="padding:22px 28px 4px;"><div style="font-size:16px;font-weight:700;">Projects</div><div style="font-size:12px;color:#6E6466;margin-top:2px;">' + M + ", worst first. Bookings are net of cancellations." + (sec.realisation ? " ₹/sq ft compared with the project's last 3 months." : "") + '</div></td></tr>' +
      '<tr><td class="px" style="padding:8px 22px 0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>' + th("Project", "left") + th("Bookings") + th("Walk-ins") + (sec.realisation ? th("₹/sq ft") : "") + '</tr>' + rows + '</table></td></tr>' +
      (idle.length ? '<tr><td class="px" style="padding:8px 28px 0;font-size:12px;color:#6E6466;"><b style="color:#4D4446;">No activity:</b> ' + idle.map(function (x) { return esc(x.p); }).join(", ") + '</td></tr>' : "") +
      (anyMissT || noProjShare >= 0.1 ? '<tr><td class="px" style="padding:6px 28px 0;font-size:11.5px;line-height:1.5;color:#8C8183;">' + (anyMissT ? "“No target” = no target row for that project in " + Ms + " (column C of the target sheets). " : "") + (noProjShare >= 0.1 ? Math.round(noProjShare * 100) + "% of " + Ms + " walk-ins have no project, so project walk-ins are understated." : "") + '</td></tr>' : "") : "";

    // attention cards: only projects with something to ask
    var att = shown.filter(function (x) { return x.ask.length; });
    var cards = sec.cards && att.length ? '<tr><td class="px" style="padding:22px 28px 2px;"><div style="font-size:16px;font-weight:700;">Needs attention</div></td></tr>' +
      att.map(function (x) {
        var s = x.s, w0 = x.ask[0].w, c = w0 <= 2 ? chip.bad : w0 <= 4 ? chip.warn : ["", "", "#8C8183"];   // border by the most serious finding, not the status
        var facts = [sgn(x.net) + " net (" + s.gross + " booked, " + s.cx + " cancelled)", x.usual >= 0.05 ? "usual " + x.usual.toFixed(1) + " a month" : "no bookings in the 3 months before", "sales value " + fcr(x.sv)];
        if (sec.channel && s.gross) facts.push(Math.round(s.cpg / s.gross * 100) + "% via CP");
        return '<tr><td class="px" style="padding:6px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ' + C.line + ';border-left:4px solid ' + c[2] + ';border-radius:10px;"><tr><td style="padding:11px 14px;">' +
          '<div style="font-size:14.5px;font-weight:700;">' + esc(x.p) + '</div><div style="font-size:12px;color:#6E6466;margin-top:2px;">' + esc(facts.join(" · ")) + '</div>' +
          x.ask.slice(0, 3).map(function (a) { return '<div style="font-size:13px;line-height:1.5;color:#2A2324;margin-top:7px;font-weight:600;">' + esc(a.f) + '</div>' + (a.q ? '<div style="font-size:13px;line-height:1.5;color:#4D4446;"><b style="color:' + c[2] + ';">Ask:</b> ' + esc(a.q) + '</div>' : ""); }).join("") +
          '</td></tr></table></td></tr>';
      }).join("") : "";

    var chan = "";
    if (sec.channel && T.gross) {
      var dr = T.dCa ? T.dNav / T.dCa : null, cr = T.cpCa ? T.cpNav / T.cpCa : null;
      chan = '<tr><td class="px" style="padding:16px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#F7F1EF" style="font-size:13px;line-height:1.55;color:#4D4446;background:#F7F1EF;border-radius:10px;padding:12px 14px;"><b>Channel partners:</b> ' + T.cpg + " of " + T.gross + " bookings came through CPs (" + Math.round(T.cpg / T.gross * 100) + "%)." +
        // CP vs direct ₹/sq ft only within one project: across projects it would mix different prices
        (sec.realisation && dr && cr && T.dCa && T.cpCa && Object.keys(G).length === 1 ? " After 2.25% brokerage, CP bookings earned ₹" + fmt(cr) + "/sq ft against ₹" + fmt(dr) + " for direct." : "") + '</td></tr></table></td></tr>';
    }
    var url = opt.url || "https://sales-dashboard-pi-one.vercel.app";
    var scopeTxt = all ? "All projects" : Object.keys(want).join(", ");
    var html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(subject) + '</title><style>@media (max-width:520px){.px{padding-left:12px!important;padding-right:12px!important}}</style></head>' +
      '<body style="margin:0;padding:0;background:#F3EFEE;"><span style="display:none;max-height:0;overflow:hidden;opacity:0;">' + esc(pre) + '</span>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EFEE;"><tr><td align="center" style="padding:24px 8px;">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:14px;overflow:hidden;' + css + '">' +
      '<tr><td class="px" bgcolor="#2A2324" style="background:#2A2324;background-image:linear-gradient(120deg,#2A2324 0%,#5A1F1C 100%);padding:22px 28px;"><div style="font-size:12px;color:#E9DCDA;font-weight:600;">Raghav Realty · Sales report · ' + esc(scopeTxt) + '</div>' +
      '<div style="font-size:22px;line-height:1.3;color:#FFFFFF;font-weight:700;margin-top:6px;">' + head + '</div><div style="font-size:14px;line-height:1.5;color:#E9DCDA;margin-top:6px;">' + esc(sub2) + '</div></td></tr>' +
      kpis + decH + tbl + cards + chan +
      '<tr><td class="px" align="center" style="padding:22px 28px 8px;"><a href="' + esc(url) + '" style="display:inline-block;background:#B3261E;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;border-radius:999px;padding:11px 26px;">Open the Control Tower</a></td></tr>' +
      '<tr><td class="px" style="padding:14px 28px 24px;"><div style="font-size:11px;line-height:1.6;color:#8C8183;border-top:1px solid ' + C.line + ';padding-top:12px;">' +
      "Source: All Data.xlsx (Walk-in, Booking details, Closing and Sourcing Targets), 1–" + new Date(R.to * 864e5).getUTCDate() + " " + Ms + " " + R.y + ". Net bookings = bookings minus cancellations in the month. Project targets = target rows with that project in column C. ₹/sq ft = agreement value after 2.25% CP brokerage ÷ carpet area; ▲▼ only for a change of 5% or more with at least 3 bookings in both periods. “Price cut” = a configuration (column AC) sold at least 5% cheaper than in the 3 months before, at least 3 bookings each side; “mix” = the average fell only because different flats sold. Status: against the project's booking target (on track = 90%+, slowing = 60–89%, behind = below 60%), or against its usual month (average of the 3 months before) when no target is given. This is an automated email from noreply@raghavgroup.in; replies are not read." +
      '</div></td></tr></table></td></tr></table></body></html>';
    return { subject: subject, html: html, preheader: pre, period: ym, stats: { net: net, target: tB, fresh: T.fresh, walkTarget: tW, projects: list.length, decisions: dec.length } };
  }

  var api = { build: build, lastFullMonth: lastFullMonth };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SalesReport = api;
})(typeof self !== "undefined" ? self : this);
