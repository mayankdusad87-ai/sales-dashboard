/* Builds the monthly management email from the cleaned dataset (same rules as the dashboard).
   build(data, { ym:"2026-10", projects:["*"] | ["Jade",...], sections:{decisions,cards,channel,realisation}, url })
   -> { subject, html, preheader, period, stats }
   Works in Node (api/email.js) and in the browser (for testing). */
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
    // bookings: Booking details when present, else the Walk-in sheet's own booking columns
    var BKS = [];
    if (data.BK && data.BK.rows && data.BK.rows.length) {
      data.BK.rows.forEach(function (b) {
        var w = b[0] >= 0 ? data.W[b[0]] : null, cp = !!b[9] || (w && /channel/i.test(SRC(w)));
        BKS.push({ p: b[1] || (w ? P(w) : ""), bday: b[2], cx: b[3], cday: b[4], av: b[5], ca: b[6], cp: cp });
      });
    } else {
      data.W.forEach(function (r) { if (r[ix.bk]) BKS.push({ p: P(r), bday: r[ix.bday], cx: r[ix.cx], cday: r[ix.cday], av: 0, ca: 0, cp: /channel/i.test(SRC(r)) }); });
    }
    // each project's usual ₹/sq ft, to leave out typing errors (more than 40% away)
    var rates = {}; BKS.forEach(function (b) { if (!b.cx && b.av > 0 && b.ca > 0 && b.p) (rates[b.p] = rates[b.p] || []).push(b.av / b.ca); });
    var med = {}; for (var k in rates) if (rates[k].length >= 5) med[k] = median(rates[k]);
    var okRate = function (b) { var m = med[b.p]; if (!m) return true; var x = b.av / b.ca / m; return x >= 0.6 && x <= 1.6; };

    function blank() { return { fresh: 0, gross: 0, cx: 0, av: 0, avx: 0, nav: 0, ca: 0, nR: 0, cpg: 0, cpNav: 0, cpCa: 0, dNav: 0, dCa: 0 }; }
    function month(from, to, G, total) {
      data.W.forEach(function (r) {
        var v = r[ix.vday]; if (r[ix.kind] !== 0 || v < from || v > to) return; var p = P(r);
        if (real(p) && inScope(p)) { (G[p] = G[p] || blank()).fresh++; }
        if (all || (real(p) && inScope(p))) total.fresh++;
        if (all && !real(p)) total.noProj++;
      });
      BKS.forEach(function (b) {
        if (!real(b.p) || !inScope(b.p)) return; var g = G[b.p] = G[b.p] || blank();
        [g, total].forEach(function (s) {
          if (b.bday >= from && b.bday <= to) {
            s.gross++; if (b.cp) s.cpg++; s.av += b.av || 0;
            if (!b.cx && b.av > 0 && b.ca > 0 && okRate(b)) { var n = b.av * (b.cp ? 1 - BRK : 1); s.nav += n; s.ca += b.ca; s.nR++; if (b.cp) { s.cpNav += n; s.cpCa += b.ca; } else { s.dNav += n; s.dCa += b.ca; } }
          }
          if (b.cx && b.cday >= from && b.cday <= to) { s.cx++; s.avx += b.av || 0; }
        });
      });
    }
    var G = {}, T = blank(); T.noProj = 0; month(R.from, R.to, G, T);
    // the usual month: average of the 3 months before
    var U = {}; for (var i = 1; i <= 3; i++) { var r3 = range(ymAdd(ym, -i)), g3 = {}, t3 = blank(); t3.noProj = 0; month(r3.from, r3.to, g3, t3); for (var p3 in g3) U[p3] = (U[p3] || 0) + (g3[p3].gross - g3[p3].cx) / 3; }
    // targets for the month: all rows for "all projects", else only rows tagged with the chosen projects
    var tB = 0, tW = 0, anyT = false;
    (data.CT || []).forEach(function (t) { if (t[1] === ym && (all || want[t[4]])) { tB += +t[2] || 0; anyT = true; } });
    (data.ST || []).forEach(function (t) { if (t[1] === ym && (all || want[t[5]])) { tW += +t[3] || 0; anyT = true; } });
    // projects to report: the chosen ones, or every real project active in the last 6 months
    var names = {}; for (var gp in G) names[gp] = 1; for (var up in U) names[up] = 1;
    if (!all) names = want;
    var lastBk = {}; BKS.forEach(function (b) { if (real(b.p) && b.bday <= R.to && !(lastBk[b.p] >= b.bday)) lastBk[b.p] = b.bday; });
    var list = Object.keys(names).filter(function (p) { return p !== "*" && real(p); }).map(function (p) {
      var s = G[p] || blank(), net = s.gross - s.cx, u = U[p] || 0, ratio = u > 0 ? net / u : net > 0 ? 1 : 0;
      var h = u < 0.5 && net <= 0 ? (s.fresh >= 10 ? "nobk" : "idle") : ratio >= 0.9 ? "good" : ratio >= 0.6 ? "warn" : "bad";
      return { p: p, s: s, net: net, usual: u, health: h, sv: s.av - s.avx, rate: s.ca ? s.nav / s.ca : null, last: lastBk[p] };
    });
    var rank = { bad: 0, warn: 1, good: 2, nobk: 3, idle: 4 };
    list.sort(function (a, b) { return rank[a.health] - rank[b.health] || b.usual - a.usual || a.p.localeCompare(b.p); });
    var active = list.filter(function (x) { return x.health !== "idle" && x.health !== "nobk"; }), idle = list.filter(function (x) { return x.health === "idle"; }), nobk = list.filter(function (x) { return x.health === "nobk"; });
    var net = T.gross - T.cx, pct = tB ? Math.round(net / tB * 100) : null, wpct = tW ? Math.round(T.fresh / tW * 100) : null;
    var M = MONL[R.m], Ms = MON[R.m];

    // decisions: the few things that need the reader, most serious first
    var dec = [];
    active.filter(function (x) { return x.health === "bad" && x.usual >= 2; }).forEach(function (x) {
      dec.push({ lvl: "bad", t: x.net <= 0 ? x.p + " sold nothing in " + M + (x.s.cx ? " (" + x.s.cx + " cancelled)" : "") : x.p + " sold " + x.net + ", against a usual " + x.usual.toFixed(1),
        d: "Usually " + x.usual.toFixed(1) + " net bookings a month (3 months before). " + (x.last ? "Last booking: " + dl(x.last) + ". " : "") + "Ask the " + x.p + " team for the reason and a recovery plan." });
    });
    active.forEach(function (x) { if (x.s.cx >= 2 && x.s.cx / Math.max(1, x.s.gross) >= 0.25) dec.push({ lvl: "warn", t: x.p + ": " + x.s.cx + " cancellations in " + M, d: x.s.cx + " cancelled against " + x.s.gross + " booked. Review why buyers are cancelling." }); });
    if (all && T.fresh >= 20 && T.noProj / T.fresh >= 0.3) dec.push({ lvl: "warn", t: "Make “Project” mandatory in the sales sheets", d: fmt(T.noProj) + " of " + fmt(T.fresh) + " walk-ins in " + M + " have no project, so project conversion and targets can't be tracked." });
    dec = dec.slice(0, 3);

    // headline
    var top = active.filter(function (x) { return x.net > 0; }).sort(function (a, b) { return b.net - a.net; })[0];
    var stalled = active.filter(function (x) { return x.health === "bad" && x.usual >= 2; }).map(function (x) { return x.p; });
    var head = M + " " + R.y + ": " + (pct != null ? "bookings reached <span style=\"color:#FCD34D;\">" + pct + "%</span> of target" : fmt(net) + " net bookings");
    if (wpct != null) head = M + " " + R.y + ": " + (wpct >= 100 ? "walk-ins beat target, " : "walk-ins at " + wpct + "%, ") + (pct != null ? "bookings reached <span style=\"color:#FCD34D;\">" + pct + "%</span>" : fmt(net) + " net bookings");
    var sub2 = (top ? (top.net === net ? "All " + net + " net bookings came from " + top.p + "." : top.p + " led with " + top.net + " net bookings.") : "No net bookings this month.") + (stalled.length ? " " + stalled.join(" and ") + (stalled.length > 1 ? " sold" : " sold") + " below their usual month." : "");
    var subject = M + " sales: " + fmt(net) + " net booking" + (net === 1 ? "" : "s") + (pct != null ? ", " + pct + "% of target" : "") + (dec.length ? " · " + dec.length + " decision" + (dec.length > 1 ? "s" : "") + " for you" : "");
    var pre = (wpct != null ? "Walk-ins " + wpct + "% of target. " : "") + (pct != null ? "Bookings " + pct + "% of target. " : "") + (dec.length ? dec.length + " decision" + (dec.length > 1 ? "s need" : " needs") + " you." : "No decisions needed.");

    // HTML (email-safe: tables, inline styles)
    var css = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2A2324;";
    var kpi = function (bg, label, big, small, note, nc) { return '<td class="k" width="50%" style="padding:6px;" valign="top"><div style="background:' + bg + ';border-radius:10px;padding:12px;"><div style="font-size:11.5px;color:#6E6466;font-weight:600;">' + label + '</div><div style="font-size:24px;font-weight:800;margin-top:2px;">' + big + (small ? '<span style="font-size:13px;color:#6E6466;font-weight:600;"> / ' + small + '</span>' : "") + '</div><div style="font-size:11.5px;color:' + (nc || "#6E6466") + ';font-weight:' + (nc ? 700 : 400) + ';margin-top:2px;">' + note + '</div></div></td>'; };
    var cons = T.fresh ? (net / T.fresh * 100) : null;
    var kpis = '<tr><td class="px" style="padding:20px 20px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      kpi(pct != null && pct < 80 ? "#FDECEA" : "#E8F7EE", "Net bookings", fmt(net), tB ? fmt(tB) : "", pct != null ? pct + "% of target" : T.gross + " booked · " + T.cx + " cancelled", pct == null ? null : pct >= 100 ? "#15803D" : pct >= 80 ? "#B45309" : "#B91C1C") +
      kpi("#F7F1EF", "Sales value", fcr(T.av - T.avx), "", "excl. GST &amp; stamp") + '</tr><tr>' +
      kpi(wpct != null && wpct < 80 ? "#FDECEA" : "#E8F7EE", "Fresh walk-ins", fmt(T.fresh), tW ? fmt(tW) : "", wpct != null ? wpct + "% of target" : "this month", wpct == null ? null : wpct >= 100 ? "#15803D" : wpct >= 80 ? "#B45309" : "#B91C1C") +
      kpi("#F7F1EF", "Walk-in → booking", cons == null ? "–" : cons > 100 ? "–" : cons.toFixed(1) + "%", "", T.fresh ? fmt(net) + " of " + fmt(T.fresh) : "no walk-ins") + '</tr></table></td></tr>';
    var decH = sec.decisions ? '<tr><td class="px" style="padding:14px 28px 4px;"><div style="font-size:16px;font-weight:700;">Decisions for you</div></td></tr><tr><td class="px" style="padding:6px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
      (dec.length ? dec.map(function (x, i) { var c = x.lvl === "bad" ? ["#B91C1C", "#FDF3F2"] : ["#B45309", "#FEF8EC"]; return (i ? '<tr><td height="8"></td></tr>' : "") + '<tr><td style="border-left:4px solid ' + c[0] + ';background:' + c[1] + ';border-radius:0 10px 10px 0;padding:12px 14px;"><div style="font-size:14.5px;font-weight:700;">' + (i + 1) + ". " + esc(x.t) + '</div><div style="font-size:13px;line-height:1.5;color:#4D4446;margin-top:3px;">' + esc(x.d) + '</div></td></tr>'; }).join("")
        : '<tr><td style="background:#E8F7EE;border-radius:10px;padding:12px 14px;font-size:13.5px;color:#15803D;font-weight:600;">Nothing needs a decision this month.</td></tr>') + '</table></td></tr>' : "";
    var chip = { good: ["On track", "#DCFCE7", "#15803D"], warn: ["Slowing", "#FEF3C7", "#B45309"], bad: ["Stalled", "#FEE2E2", "#B91C1C"] };
    var cards = sec.cards && active.length ? '<tr><td class="px" style="padding:22px 28px 6px;"><div style="font-size:16px;font-weight:700;">Projects</div><div style="font-size:12px;color:#6E6466;margin-top:2px;">' + M + " against each project's usual month (average of the 3 months before), worst first</div></td></tr>" +
      active.map(function (x) {
        var c = chip[x.health], s = x.s, cv = s.fresh ? (x.net / s.fresh * 100) : null;
        var line2 = "Walk-ins " + fmt(s.fresh) + " · Conversion " + (cv == null || cv > 100 || cv < 0 ? "–" : cv.toFixed(1) + "%") + " · Cancelled " + s.cx;
        var line3 = "Sales value " + fcr(x.sv) + (sec.realisation ? " · ₹/sq ft " + (x.rate ? fmt(x.rate) : "–") : "") + (sec.channel && s.gross ? " · Via CP " + Math.round(s.cpg / s.gross * 100) + "%" : "");
        var why = x.net <= 0 ? (x.last ? "Last booking " + dl(x.last) + "." : "No bookings on record.") : x.health === "good" ? "" : "Below its usual " + x.usual.toFixed(1) + " a month.";
        return '<tr><td class="px" style="padding:6px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ECE4E2;border-radius:12px;"><tr><td style="padding:12px 14px;">' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:15px;font-weight:700;">' + esc(x.p) + '</td><td align="right"><span style="white-space:nowrap;background:' + c[1] + ';color:' + c[2] + ';font-weight:700;font-size:11.5px;border-radius:999px;padding:2px 9px;">' + c[0] + '</span></td></tr></table>' +
          '<div style="font-size:13.5px;margin-top:6px;"><b style="font-size:18px;">' + String(x.net).replace("-", "−") + '</b> net bookings <span style="color:#6E6466;">(usual ' + x.usual.toFixed(1) + ')</span></div>' +
          '<div style="font-size:12.5px;color:#4D4446;margin-top:4px;line-height:1.5;">' + line2 + '<br>' + line3 + '</div>' +
          (why ? '<div style="font-size:12px;color:#6E6466;margin-top:4px;font-style:italic;">' + esc(why) + '</div>' : "") + '</td></tr></table></td></tr>';
      }).join("") + (nobk.length ? nobk.map(function (x) { return '<tr><td class="px" style="padding:6px 28px 0;font-size:12.5px;color:#B45309;"><b>' + esc(x.p) + "</b> · " + fmt(x.s.fresh) + " walk-ins, but no bookings recorded in Booking details. Worth a check.</td></tr>"; }).join("") : "") + (idle.length ? '<tr><td class="px" style="padding:6px 28px 0;font-size:12.5px;color:#6E6466;"><b style="color:#4D4446;">No activity:</b> ' + idle.map(function (x) { return esc(x.p); }).join(", ") + '</td></tr>' : "") : "";
    var chan = "";
    if (sec.channel && T.gross) {
      var dr = T.dCa ? T.dNav / T.dCa : null, cr = T.cpCa ? T.cpNav / T.cpCa : null;
      chan = '<tr><td class="px" style="padding:16px 28px 0;"><div style="font-size:13px;line-height:1.55;color:#4D4446;background:#F7F1EF;border-radius:10px;padding:12px 14px;"><b>Channel partners:</b> ' + T.cpg + " of " + T.gross + " bookings came through CPs (" + Math.round(T.cpg / T.gross * 100) + "%)." +
        (sec.realisation && dr && cr && T.dCa && T.cpCa ? " After 2.25% brokerage, CP bookings earned ₹" + fmt(cr) + "/sq ft against ₹" + fmt(dr) + " for direct (" + (cr >= dr ? "+" : "") + ((cr - dr) / dr * 100).toFixed(1) + "%)." : "") + '</div></td></tr>';
    }
    var url = opt.url || "https://sales-dashboard-pi-one.vercel.app";
    var scopeTxt = all ? "All projects" : Object.keys(want).join(", ");
    var html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(subject) + '</title><style>@media (max-width:520px){.px{padding-left:14px!important;padding-right:14px!important}}</style></head>' +
      '<body style="margin:0;padding:0;background:#F3EFEE;"><span style="display:none;max-height:0;overflow:hidden;opacity:0;">' + esc(pre) + '</span>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EFEE;"><tr><td align="center" style="padding:24px 12px;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:14px;overflow:hidden;' + css + '">' +
      '<tr><td class="px" style="background:#2A2324;background-image:linear-gradient(120deg,#2A2324 0%,#5A1F1C 100%);padding:22px 28px;"><div style="font-size:12px;color:#E9DCDA;font-weight:600;">Raghav Realty · Sales report · ' + esc(scopeTxt) + '</div>' +
      '<div style="font-size:22px;line-height:1.3;color:#FFFFFF;font-weight:700;margin-top:6px;">' + head + '</div><div style="font-size:14px;line-height:1.5;color:#E9DCDA;margin-top:6px;">' + esc(sub2) + '</div></td></tr>' +
      kpis + decH + cards + chan +
      '<tr><td class="px" align="center" style="padding:22px 28px 8px;"><a href="' + esc(url) + '" style="display:inline-block;background:#B3261E;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;border-radius:999px;padding:11px 26px;">Open the Control Tower</a></td></tr>' +
      '<tr><td class="px" style="padding:14px 28px 24px;"><div style="font-size:11px;line-height:1.6;color:#8C8183;border-top:1px solid #ECE4E2;padding-top:12px;">' +
      "Source: All Data.xlsx (Walk-in, Booking details, targets), 1–" + new Date(R.to * 864e5).getUTCDate() + " " + Ms + " " + R.y + ". Net bookings = bookings minus cancellations in the month. ₹/sq ft = agreement value after 2.25% CP brokerage ÷ carpet area. On track = at least 90% of the usual month, slowing = 60–89%, stalled = below 60%. This is an automated email from noreply@raghavgroup.in; replies are not read." +
      '</div></td></tr></table></td></tr></table></body></html>';
    return { subject: subject, html: html, preheader: pre, period: ym, stats: { net: net, target: tB, fresh: T.fresh, walkTarget: tW, projects: list.length, decisions: dec.length, hasTargets: anyT } };
  }

  var api = { build: build, lastFullMonth: lastFullMonth };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SalesReport = api;
})(typeof self !== "undefined" ? self : this);
