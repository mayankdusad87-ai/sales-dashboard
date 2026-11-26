(function(){
"use strict";
var $=function(id){return document.getElementById(id)};
var DAY=864e5, REFRESH_MS=5*60*1000;
var MN=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function store(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){return null}}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]})}
// project filter: "" = all, one name, or several names joined with PSEP
var PSEP="\u0002";
function pSel(v){return v?v.split(PSEP):[]}
function pMulti(v){return!!v&&v.indexOf(PSEP)>=0}
function pOne(v){return!!v&&!pMulti(v)}
function pHas(v,p){return v===p||(v.indexOf(PSEP)>=0&&(PSEP+v+PSEP).indexOf(PSEP+p+PSEP)>=0)}
function pKeep(v,set){return set?pSel(v).filter(function(p){return set.has(p)}).join(PSEP):v}
function pName(v){var n=pSel(v).length;return n>3?n+" projects":lab(v)}
// Site Head: "" = all the person's Site Head projects
function sLab(){return F.proj?lab(F.proj):(ALLOW&&ALLOW.st?"all your projects":"all projects")}
function lab(v){return v===""||v==null?"Not entered":pMulti(v)?v.split(PSEP).join(", "):v}

function fmt(n){return n==null||isNaN(n)?"–":Math.round(n).toLocaleString("en-IN")}
function pct(n,d){return d?n/d*100:null}
function fp(v,dp){return v==null?"–":v.toFixed(dp==null?(Math.abs(v)<10?1:0):dp)+"%"}
function median(a){if(!a.length)return null;var s=a.slice().sort(function(x,y){return x-y}),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2}
function isCP(src){return /channel/i.test(src)}
// channel of a row: bookings by Source Type (Booking details Q), walk-ins by Source (Walk-in Z)
function chOf(r){return r.bkRow?r.chan:isCP(r.src)?"Indirect":"Direct"}

/* ---------- dates ---------- */
function today(){return Math.floor((Date.now()+5.5*36e5)/DAY)} // India time
function ymd(d){var x=new Date(d*DAY);return[x.getUTCFullYear(),x.getUTCMonth(),x.getUTCDate()]}
function mkDay(y,m,d){return Math.floor(Date.UTC(y,m,d)/DAY)}
function ymOf(d){var a=ymd(d);return a[0]*100+a[1]+1}
function ymLab(ym){return MN[ym%100-1]+" "+String(Math.floor(ym/100)).slice(2)}
function monStart(ym){return mkDay(Math.floor(ym/100),ym%100-1,1)}
function monEnd(ym){return mkDay(Math.floor(ym/100),ym%100,0)}
function ymAdd(ym,n){var y=Math.floor(ym/100),m=ym%100-1+n;y+=Math.floor(m/12);m=((m%12)+12)%12;return y*100+m+1}
function addMonths(d,n){var a=ymd(d),ym=ymAdd(a[0]*100+a[1]+1,n),last=ymd(monEnd(ym))[2];return mkDay(Math.floor(ym/100),ym%100-1,Math.min(a[2],last))}
function weekOf(d){var a=ymd(d),first=new Date(Date.UTC(a[0],a[1],1)).getUTCDay();return Math.ceil((a[2]+((first+6)%7))/7)}
function monthsIn(p){var out=[],ym=ymOf(p.from),e=ymOf(p.to);while(ym<=e){out.push(ym);ym=ymAdd(ym,1)}return out}
function fyStart(d){var a=ymd(d);return a[1]>=3?a[0]:a[0]-1}

/* ---------- state ---------- */
var DATA=null,ROWS=[],INV=[],CT=[],ST=[],MIN_DAY=0;
var F={per:"mtd",proj:"",cm:"",sm:"",src:"",cp:""};
var tab="cmd",focus=null,ui={trend:"book",chan:"split",why:"lost",fdim:"proj",strend:"book",ssrc:"src"};
var lastLoad=0,loadErr="";

/* ---------- period ---------- */
function period(key){
  var t=today(),a=ymd(t),cur=a[0]*100+a[1]+1,fy=fyStart(t),p;
  if(key==="mtd")p={from:monStart(cur),to:t,label:"This month",shift:1};
  else if(key==="lm"){var l=ymAdd(cur,-1);p={from:monStart(l),to:monEnd(l),label:"Last month ("+ymLab(l)+")",shift:1}}
  else if(key==="l30")p={from:t-29,to:t,label:"Last 30 days",shift:0};
  else if(key==="qtd"){var qs=ymAdd(cur,-((a[1]-3+12)%3));p={from:monStart(qs),to:t,label:"This quarter",shift:3}}
  else if(key==="fy")p={from:mkDay(fy,3,1),to:t,label:"FY "+fy+"-"+String(fy+1).slice(2)+" to date",shift:12};
  else if(key==="lfy")p={from:mkDay(fy-1,3,1),to:mkDay(fy,2,31),label:"FY "+(fy-1)+"-"+String(fy).slice(2),shift:12};
  else if(key==="l12")p={from:monStart(ymAdd(cur,-11)),to:t,label:"Last 12 months",shift:12};
  else if(key==="all")p={from:MIN_DAY,to:t,label:"All time",shift:0};
  else if(/^m\d{6}$/.test(key)){var ym=+key.slice(1);p={from:monStart(ym),to:Math.min(monEnd(ym),t),label:ymLab(ym),shift:1,month:ym}}
  else return period("fy");
  if(key==="mtd")p.month=cur;if(key==="lm")p.month=ymAdd(cur,-1);
  p.key=key;p.full={from:p.from,to:p.month?monEnd(p.month):(key==="fy"?mkDay(fy+1,2,31):key==="qtd"?monEnd(ymAdd(ymOf(p.from),2)):p.to)};
  return p;
}
function prevOf(p){if(!p.shift)return null;
  if(p.month&&p.to===monEnd(p.month)){var pm=ymAdd(p.month,-1);return{from:monStart(pm),to:monEnd(pm),label:"last month"}}
  return{from:addMonths(p.from,-p.shift),to:addMonths(p.to,-p.shift),label:p.shift===1?"last month":p.shift===3?"last quarter":"last year"}}

/* ---------- data ---------- */
function ingest(d){
  DATA=d;var f=d.fields,D=d.dict,ix={};f.forEach(function(k,i){ix[k]=i});
  HAS_ID=!!(d.ID&&d.ID.some(function(x){return x}));TIME_OK=false;HAS_NAMES=!!(d.NM&&d.NM.length);
  ROWS=d.W.map(function(r,n){var o={};f.forEach(function(k,i){o[k]=D[k]?D[k][r[i]]:r[i]});o.uniq=/^unique\s*revisit$/i.test(o.awv||"");o.id=d.ID?d.ID[n]||"":"";o.nm=d.NM?d.NM[n]||"":"";if(o.wait>=0)TIME_OK=true;return o});
  // Booking details: every booking becomes its own row (kind 3) decided by Booking details alone; the matched
  // walk-in (lib/clean.js, matcher) only adds the first visit date, name and profile for display;
  // walk-in rows then only say whether that customer booked (won 1) or booked and cancelled (won 2)
  HAS_BK=!!(d.BK&&d.BK.rows&&d.BK.rows.length);
  if(HAS_BK){var WK=ROWS,BKR=[];
    ROWS.forEach(function(r){r.bk=0;r.cx=0;r.bday=-1;r.cday=-1});
    d.BK.rows.forEach(function(b){var w=b[0]>=0?ROWS[b[0]]:null,o={};
      if(w)Object.assign(o,w);else f.forEach(function(k){o[k]=D[k]?"":-1});
      o.kind=3;o.vday=-1;o.uniq=false;o.wait=-1;o.won=0;o.bk=1;o.bday=b[2];o.cx=b[3];o.cday=b[4];o.av=b[5];o.carpet=b[6];
      // project, managers and channel come from Booking details only; column Q (Source Type) decides the channel, R names the CP firm
      o.proj=b[1];o.cm=b[7];o.sm=b[8];o.cp=b[9];o.chan=b[16]||"Not set";o.src=o.chan==="Indirect"?"Channel Partner":o.chan;
      // configuration actually booked (Booking details AC), not the walk-in's preference
      if(b.length>12)o.cfg=b[12]||"";
      o.id=b[10];o.fv=b[11];o.why=b[14]||"";o.linked=!o.why||o.why==="check";o.nm=w?w.nm:"";o.bkRow=1;
      (b[15]||[]).forEach(function(n){var r=WK[n];if(!r)return;if(!b[3]){r.won=1;r.wonDay=b[2]}else if(!r.won)r.won=2});
      BKR.push(o)});
    ROWS=ROWS.concat(BKR);
    // a booking whose ₹/sq ft is more than 40% away from its project's median is almost always a typing error in
    // agreement value (AH) or carpet area (AD): it stays in sales value but is left out of realisation and listed
    var PR={};BKR.forEach(function(r){if(!r.cx&&r.av>0&&r.carpet>0&&r.proj)(PR[r.proj]||(PR[r.proj]=[])).push(r.av/r.carpet)});
    var MED={};for(var pj in PR)if(PR[pj].length>=5)MED[pj]=median(PR[pj]);
    RATE_OUT=[];BKR.forEach(function(r){var m=MED[r.proj];if(m&&r.av>0&&r.carpet>0){var x=r.av/r.carpet/m;if(x<.6||x>1.6){r.rOut=1;if(!r.cx)RATE_OUT.push(r)}}})}
  M("nr").ph=!HAS_BK;
  M("net").def=HAS_BK?"Bookings in Booking details (Booking Date, column AN, and an Overall Status) minus bookings marked “Cancelled at Booking”, counted on the Cancellation Date (column V). Target: Closing Targets (Sourcing Targets when a sourcing manager is picked).":NET_DEF;
  MIN_DAY=ROWS.reduce(function(m,r){return r.vday>0&&r.vday<m?r.vday:m},today());
  CT=d.CT.map(function(r){return{m:r[0],ym:+r[1].replace("-",""),t:r[2],w:r[3],p:r[4]||"All"}});
  ST=d.ST.map(function(r){return{m:r[0],ym:+r[1].replace("-",""),b:r[2],t:r[3],w:r[4],p:r[5]||"All"}});
  INV=d.INV.map(function(r){return{proj:r[0],unit:r[1],floor:r[2],grp:r[3],st:r[4],area:r[5],type:r[6]}});
}
function pass(r,FF){
  // each tab shows only the projects this person has that right for
  if(ALLOW){var A=alw();if(A&&!A.has(r.proj))return false}
  if(FF.proj&&!pHas(FF.proj,r.proj))return false;
  if(FF.cm&&r.cm!==FF.cm)return false;
  if(FF.sm&&r.sm!==FF.sm)return false;
  if(FF.cp&&r.cp!==FF.cp)return false;
  if(FF.src){if(FF.src==="Direct"||FF.src==="Indirect"){if(chOf(r)!==FF.src)return false}else if(r.src!==FF.src)return false}
  return true;
}
function blank(){return{nAv:0,fresh:0,rev:0,gross:0,cx:0,hot:0,tat:[],wt:[],cps:{},cpWalk:0,av:0,avx:0,avR:0,ca:0,nR:0,sf:0,sfx:0,noCa:0}}
// money and turnaround of one booking row (Booking details): value, value per sq ft, days from first visit
// CP brokerage taken off indirect bookings for realisation (sales value stays the full agreement value)
var BRK=.0225;
function netAV(r){return r.av*(r.chan==="Indirect"?1-BRK:1)}
// area sold = carpet area (AD) booked in the period minus carpet area cancelled in it, like sales value
function addBk(s,r){s.gross++;if(r.carpet>0)s.sf+=r.carpet;else s.noCa++;var fv=r.fv>0?r.fv:r.vday;if(fv>0&&r.bday>=fv)s.tat.push(r.bday-fv);if(r.av>0){s.nAv++;s.av+=r.av;if(!r.cx&&r.carpet>0&&!r.rOut){s.avR+=netAV(r);s.ca+=r.carpet;s.nR++}}}
function addCx(s,r){s.cx++;if(r.carpet>0)s.sfx+=r.carpet;if(r.av>0)s.avx+=r.av}
// conversion = NET bookings (bookings − cancellations) ÷ fresh walk-ins, so it matches the Net Bookings number everywhere
// a booking rate above 100% means the walk-ins behind those bookings are tagged elsewhere: show "–", never a fake rate
function fin(s){s.net=s.gross-s.cx;s.conv=pct(s.net,s.fresh);s.convBad=s.conv!=null&&s.conv>100;s.convNeg=s.net<0&&s.fresh>0;if(s.convBad||s.convNeg)s.conv=null;s.tatM=median(s.tat);s.sv=HAS_BK?s.av-s.avx:null;s.sqft=HAS_BK?s.sf-s.sfx:null;s.rpsf=HAS_BK&&s.ca?s.avR/s.ca:null;s.wtM=median(s.wt);s.wt15=s.wt.filter(function(w){return w>15}).length;s.ncp=Object.keys(s.cps).length;return s}
// one pass: totals, optional groups by keyFn
function stats(FF,p,keyFn){
  var tot=blank(),G={};
  for(var i=0;i<ROWS.length;i++){var r=ROWS[i];if(!pass(r,FF))continue;
    var inV=r.vday>=p.from&&r.vday<=p.to,inB=r.bk&&r.bday>=p.from&&r.bday<=p.to,inC=r.cx&&r.cday>=p.from&&r.cday<=p.to;
    if(!inV&&!inB&&!inC)continue;
    var tg=[tot];if(keyFn){var k=keyFn(r);if(!G[k])G[k]=blank();tg.push(G[k])}
    for(var j=0;j<tg.length;j++){var s=tg[j];
      if(inV){if(r.kind===0){s.fresh++;if(r.wait>=0)s.wt.push(r.wait);if(r.aff==="Hot"&&!r.bk&&!r.won)s.hot++}else if(r.uniq)s.rev++;if(r.cp&&isCP(r.src)){s.cps[r.cp]=1;s.cpWalk++}}
      if(inB)addBk(s,r);
      if(inC)addCx(s,r)}}
  fin(tot);for(var g in G)fin(G[g]);
  return{tot:tot,G:G};
}
// buckets: months of p, or weeks 1-6 when p is one month
function series(FF,p,weekly){
  var keys=weekly?[1,2,3,4,5,6]:monthsIn(p),B={};keys.forEach(function(k){B[k]=blank()});
  function key(d){return weekly?weekOf(d):ymOf(d)}
  for(var i=0;i<ROWS.length;i++){var r=ROWS[i];if(!pass(r,FF))continue;var s;
    if(r.vday>=p.from&&r.vday<=p.to&&(s=B[key(r.vday)])){if(r.kind===0){s.fresh++;if(r.wait>=0)s.wt.push(r.wait);if(r.aff==="Hot"&&!r.bk&&!r.won)s.hot++}else if(r.uniq)s.rev++;if(r.cp&&isCP(r.src)){s.cps[r.cp]=1;s.cpWalk++}}
    if(r.bk&&r.bday>=p.from&&r.bday<=p.to&&(s=B[key(r.bday)]))addBk(s,r);
    if(r.cx&&r.cday>=p.from&&r.cday<=p.to&&(s=B[key(r.cday)]))addCx(s,r)}
  keys.forEach(function(k){fin(B[k])});
  if(weekly)while(keys.length>4&&!B[keys[keys.length-1]].fresh&&!B[keys[keys.length-1]].gross&&!B[keys[keys.length-1]].cx&&keys[keys.length-1]>weekOf(p.full.to))keys.pop();
  return{keys:keys,B:B};
}
/* ---------- targets ---------- */
function targets(FF,p){
  var months=monthsIn(p),res={book:null,walk:null,bookM:{},walkM:{},bookW:null,walkW:null,why:""};
  if(FF.src||FF.cp){res.why="Targets are set per manager and project, not per source";return res}
  var bRows,wRows;
  if(FF.cm&&FF.sm){res.why="No target for a closing + sourcing manager pair";return res}
  // a project picked: roll up only the target rows tagged with it in column C
  var inP=function(t){return!FF.proj||pHas(FF.proj,t.p)};
  if(FF.cm){bRows=CT.filter(function(t){return t.m===FF.cm&&inP(t)}).map(function(t){return{ym:t.ym,v:t.t,w:t.w}});wRows=null}
  else if(FF.sm){bRows=ST.filter(function(t){return t.m===FF.sm&&inP(t)}).map(function(t){return{ym:t.ym,v:t.b,w:null}});wRows=ST.filter(function(t){return t.m===FF.sm&&inP(t)}).map(function(t){return{ym:t.ym,v:t.t,w:t.w}})}
  else{bRows=CT.filter(inP).map(function(t){return{ym:t.ym,v:t.t,w:t.w}});wRows=ST.filter(inP).map(function(t){return{ym:t.ym,v:t.t,w:t.w}})}
  if(FF.proj&&!bRows.length&&!(wRows&&wRows.length)){res.why="No target tagged to "+pName(FF.proj)+" yet (column C of the target sheets)";return res}
  function sum(rows,M){var tot=0,any=false,W=[0,0,0,0,0,0],anyW=false;rows.forEach(function(t){if(months.indexOf(t.ym)<0)return;M[t.ym]=(M[t.ym]||0)+t.v;tot+=t.v;any=true;if(t.w)t.w.forEach(function(x,i){W[i]+=x;if(x)anyW=true})});return{tot:any?tot:null,W:anyW?W:null}}
  var b=sum(bRows,res.bookM);res.book=b.tot;res.bookW=b.W;
  if(wRows){var w=sum(wRows,res.walkM);res.walk=w.tot;res.walkW=w.W}
  if(res.book==null&&res.walk==null)res.why="No target set for "+(months.length===1?ymLab(months[0]):"these months");
  return res;
}
// achievement over months that have a target, with pace for a running period
function achieve(ser,M,metric){
  var got=0,tgt=0,ms=[];for(var k in M){k=+k;if(ser.B[k]){got+=metric(ser.B[k]);tgt+=M[k];ms.push(k)}}
  if(!ms.length||!tgt)return null;
  ms.sort();var s=monStart(ms[0]),e=monEnd(ms[ms.length-1]),t=today();
  var pace=t>=e?1:t<s?0:(t-s+1)/(e-s+1);
  var pc=got/tgt*100;
  return{got:got,tgt:tgt,pc:pc,pace:pace*100,ms:ms,st:pc>=pace*100?"good":pc>=pace*80?"warn":"bad"};
}
/* ---------- inventory ---------- */
function inv(proj){
  var s={tot:0,Sold:0,"On hold":0,Unsold:0,area:0,uArea:0};
  INV.forEach(function(u){if(proj&&!pHas(proj,u.proj))return;s.tot++;s[u.grp]++;s.area+=u.area;if(u.grp==="Unsold")s.uArea+=u.area});
  return s;
}
function invBy(proj,key){var G={};INV.forEach(function(u){if(proj&&!pHas(proj,u.proj))return;var k=u[key];if(!G[k])G[k]={tot:0,Sold:0,"On hold":0,Unsold:0};G[k].tot++;G[k][u.grp]++});return G}

/* ---------- metric catalogue ---------- */
var METRICS=[
  {id:"net",label:"Net Bookings",fx:"Net Bookings = Bookings − Cancellations",v:function(s){return s.net},f:fmt,tgt:"book",up:1,def:"Bookings (row has a Booking Date or Booking Done = Y) minus cancellations (Booking Cancellation = Yes) in the period. Booking month from Booking Date; cancellation month from Cancellation Date. Target: Closing Targets (Sourcing Targets when a sourcing manager is picked)."},
  {id:"fresh",label:"Fresh Walk-ins",fx:"Fresh Walk-ins = count of visits marked Fresh",v:function(s){return s.fresh},f:fmt,tgt:"walk",up:1,def:"Rows where Customer Fresh/Revisit (column AW) = Fresh, by Date of Visit. Target: Sourcing Targets → Walk-ins."},
  {id:"conv",label:"Walk-in to Booking",fx:"Conversion % = Net bookings ÷ Fresh walk-ins × 100",v:function(s){return s.conv},f:function(v){return fp(v)},up:1,min:5,def:"Net bookings in the period (bookings minus cancellations, the same number as the Net Bookings tile) ÷ fresh walk-ins in the period. No target is set for this."},
  {id:"rev",label:"Unique Revisits",fx:"Unique Revisits = count of visits marked Unique Revisit",v:function(s){return s.rev},f:fmt,up:1,def:"Rows where Customer Fresh/Revisit (column AW) = Unique Revisit, by Date of Visit. Second, third and later revisits are not counted."},
  {id:"cx",label:"Cancellations",fx:"Cancellations = count of bookings marked cancelled",v:function(s){return s.cx},f:fmt,up:-1,def:"Rows with Booking Cancellation = Yes, by Cancellation Date (Booking Date when that is empty)."},
  {id:"hot",label:"Hot Leads Open",v:function(s){return s.hot},f:fmt,up:1,def:"Fresh walk-ins in the period with Customer Affinity = Hot that have not booked yet."},
  {id:"cpf",label:"Active CP Firms",fx:"Active CP Firms = number of different CP companies with 1+ walk-in",v:function(s){return s.ncp},f:fmt,up:1,def:"Distinct Channel Partner Company names (column AA) that brought at least one walk-in (fresh or revisit) in the period, where Source = Channel Partner."},
  {id:"sv",label:"Sales Value",fx:"Sales value = agreement value of bookings − agreement value of cancellations",v:function(s){return s.sv},f:fcr,up:1,def:"Agreement value (Booking details, column AH, excluding GST and stamp duty) of bookings in the period, minus the agreement value of bookings cancelled in the period."},
  {id:"tatb",label:"Booking TAT",unit:"days",fx:"Booking TAT = booking date − first visit date (median)",v:function(s){return s.tatM},f:function(v){return v==null?"–":String(Math.round(v))},up:-1,def:"Days from the customer’s first visit (their earliest fresh walk-in with that Form No, on or before the booking) to the Booking Date (Booking details, column AN). Where a Form No was reused, only visits with the same customer name count. Half the bookings closed faster than this. Bookings with no matching walk-in are left out."},
  {id:"tat",label:"Waiting Time",unit:"min",fx:"TAT = median minutes from Time In to Time Attended",v:function(s){return s.wtM},f:function(v){return v==null?"–":String(Math.round(v))},up:-1,def:"Fresh walk-ins in the period with both Time In and Time Attended filled (waits over 10 hours are treated as typing errors and left out). Half of the customers waited this long or less. Aim: attended within 15 minutes."},
  {id:"nr",label:"Net Realisation",ph:true,unit:"/sq ft",fx:"Net realisation = (agreement value − CP brokerage) ÷ carpet area",v:function(s){return s.rpsf},f:function(v){return v==null?"–":"₹"+fmt(Math.round(v))},up:1,def:"Agreement value (column AH, excluding GST and stamp duty), less 2.25% CP brokerage on bookings through a channel partner, ÷ carpet area (column AD). Over bookings in the period that are not cancelled and have both values. Comes from Booking details. Sq ft sold is separate: carpet area (column AD) of all bookings in the period, minus the carpet area of bookings cancelled in the period."},
  {id:"inv",label:"Unsold Inventory",fx:"Unsold = units with status Available",inv:true,def:"From the Inventory Status tab, as of now (not affected by the period). Sold = Sold + Booked + Overdue · On hold = Reserved + Blocked · Unsold = Available."}
];
var SITE_TILES=["net","fresh","conv","rev","cx","cpf","tat","nr"];
var MGMT_TILES=["net","fresh","conv","rev","cx","cpf","inv"];
function M(id){for(var i=0;i<METRICS.length;i++)if(METRICS[i].id===id)return METRICS[i]}
var NET_DEF=M("net").def;
// tiles stay at 7 (Management) and 8 (Site Head); money and turnaround replace the less decisive ones once Booking details is connected
function mgmtTiles(){return HAS_BK?["net","sv","nr","fresh","conv","tatb","cx"]:MGMT_TILES}
function siteTiles(){return HAS_BK?["net","fresh","conv","rev","cx","nr","tatb","tat"]:SITE_TILES}
// money: ₹14.2 Cr / ₹85 L on cards; exact rupees in tooltips
function sqf(v){return v==null?"–":(v<0?"−":"")+fmt(Math.abs(v))+" sq ft"}
function fcr(v){if(v==null)return"–";var a=Math.abs(v),sg=v<0?"−":"";return sg+(a>=1e7?"₹"+(a/1e7).toFixed(a>=1e9?0:a>=1e8?1:2).replace(/\.?0+$/,"")+" Cr":a>=1e5?"₹"+(a/1e5).toFixed(0)+" L":"₹"+fmt(Math.round(a)))}

/* ---------- small renderers ---------- */
// one line-icon set (lucide shapes)
var ICP={check:'<path d="M20 6 9 17l-5-5"/>',x:'<path d="M18 6 6 18M6 6l12 12"/>',bang:'<path d="M12 5v9M12 19h.01"/>',warn:'<path d="M12 3 2 20h20L12 3zM12 10v4M12 17h.01"/>',down:'<path d="M12 5v14M19 12l-7 7-7-7"/>',chev:'<path d="m6 9 6 6 6-6"/>',tabCmd:'<path d="M3 12 12 4l9 8"/><path d="M5 10v10h14V10M10 20v-6h4v6"/>',tabMgmt:'<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',tabSite:'<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',tabAdm:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'};
function ic(n){return'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">'+ICP[n]+'</svg>'}
function si(st){return st?'<span class="si '+st+'" aria-hidden="true">'+ic(st==="good"?"check":st==="warn"?"bang":"x")+'</span>':""}

function pill(v,st){return'<span class="pill '+(st||"na")+'">'+(v==null?"–":fp(v,0))+'</span>'}
function hbar(v,max,cls,mark){var w=max>0?Math.max(0,Math.min(100,v/max*100)):0;return'<div class="hb"><i class="'+(cls||"")+'" style="width:'+w.toFixed(1)+'%"></i>'+(mark!=null&&max>0?'<b style="left:'+Math.min(100,mark/max*100).toFixed(1)+'%"></b>':"")+'</div>'}
function stOf(pc,pace){if(pc==null)return"";return pc>=pace?"good":pc>=pace*.8?"warn":"bad"}
function deltaTxt(cur,prev,m,P){if(!P||prev==null||cur==null)return"";var d=cur-prev;if(m.id==="conv")return(d>=0?"▲ ":"▼ ")+Math.abs(d).toFixed(1)+" pts vs "+P.label;if(!prev)return cur?"New vs "+P.label:"";var r=d/prev*100;if(Math.abs(r)>999)return(d>=0?"▲ ":"▼ ")+"from "+m.f(prev)+(m.id==="tatb"?" days":"")+" "+P.label;return(d>=0?"▲ ":"▼ ")+Math.abs(r).toFixed(0)+"% vs "+P.label}
function deltaSt(cur,prev,m){if(prev==null||cur==null||cur===prev)return"";return(cur>prev)===(m.up>0)?"good":"bad"}
function empty(t){return'<div class="empty">'+esc(t)+'</div>'}
function card(id,title,sub,togs,body,cls){return'<section class="card" id="'+id+'"><div class="chd"><h2>'+title+'</h2>'+(sub?'<span class="sub">'+sub+'</span>':"")+(togs||"")+'</div><div class="cbd'+(cls?" "+cls:"")+'">'+body+'</div></section>'}
function togs(name,opts,cur){return'<div class="togs">'+opts.map(function(o){return'<button class="tog" data-ui="'+name+'" data-uv="'+o[0]+'" aria-pressed="'+(o[0]===cur)+'">'+o[1]+'</button>'}).join("")+'</div>'}
function drow(f,v,cells,on){return'<tr class="click'+(on?" on":"")+'" data-f="'+f+'" data-v="'+esc(v)+'" tabindex="0">'+cells+'</tr>'}

// column chart: items [{lab,v,t,tip,per}]
var gradN=0;
function colChart(el,items,opt){
  opt=opt||{};var W=Math.max(260,el.clientWidth||400),H=Math.max(150,el.clientHeight||200),top=18,bot=20,l=6,r=6;
  var max=0;items.forEach(function(it){max=Math.max(max,it.v||0,it.t||0)});if(!max)max=1;
  var n=items.length,bw=(W-l-r)/n,pad=Math.min(14,bw*.22),h=H-top-bot,step=n>14?Math.ceil(n/12):1;
  var gid="g"+(++gradN),s='<svg class="ch" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="'+esc(opt.aria||"chart")+'"><defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var('+(opt.alt?"--alt1":"--bar2")+')"/><stop offset="1" stop-color="var('+(opt.alt?"--alt1":"--bar2")+')"/></linearGradient></defs>';
  s+='<line class="gl" x1="'+l+'" x2="'+(W-r)+'" y1="'+(top+h)+'" y2="'+(top+h)+'"/>';
  items.forEach(function(it,i){var x=l+i*bw+pad,w=Math.max(2,bw-2*pad),v=it.v||0,bh=v/max*h,y=top+h-bh;
    s+='<rect class="b" fill="url(#'+gid+')" x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+Math.max(0,bh).toFixed(1)+'" rx="3"/>';
    if(it.t!=null){var ty=top+h-it.t/max*h;s+='<line class="tg" x1="'+(x-3).toFixed(1)+'" x2="'+(x+w+3).toFixed(1)+'" y1="'+ty.toFixed(1)+'" y2="'+ty.toFixed(1)+'"/>'}
    if(n<=16||i%step===0)s+='<text class="vl" x="'+(x+w/2).toFixed(1)+'" y="'+Math.max(11,(it.t!=null&&top+h-it.t/max*h<y+2&&y-(top+h-it.t/max*h)<15?Math.min(y,top+h-it.t/max*h):y)-4).toFixed(1)+'">'+esc(opt.fmt?opt.fmt(it.v):fmt(it.v))+'</text>';
    if(i%step===0)s+='<text class="xl" x="'+(x+w/2).toFixed(1)+'" y="'+(H-5)+'">'+esc(bw*step<48?String(it.lab).replace(/^([A-Z][a-z]{2}) \d\d$/,"$1"):it.lab)+'</text>';
    s+='<rect class="hit" x="'+(l+i*bw).toFixed(1)+'" y="0" width="'+bw.toFixed(1)+'" height="'+H+'" data-tip="'+esc(it.tip||"")+'"'+(it.per?' data-per="'+it.per+'"':"")+'/>';
  });
  el.innerHTML=s+'</svg>';
}

/* ---------- filter bar ---------- */
function uniq(key){var c={};ROWS.forEach(function(r){var v=r[key];if(v)c[v]=(c[v]||0)+1});return Object.keys(c).sort(function(a,b){return c[b]-c[a]})}
function setOpts(sel,opts,cur){sel.innerHTML=opts.map(function(o){return'<option value="'+esc(o[0])+'"'+(o[0]===cur?" selected":"")+'>'+esc(o[1])+'</option>'}).join("")}
// current and last month are already "This month" / "Last month", so the list starts two months back
function normPer(k){var cur=ymOf(today());return k==="m"+cur?"mtd":k==="m"+ymAdd(cur,-1)?"lm":k}
function recentMonths(n){var out=[],ym=ymAdd(ymOf(today()),-2);for(var i=0;i<n;i++){out.push(["m"+ym,ymLab(ym)]);ym=ymAdd(ym,-1)}return out}
function projList(){var c={};ROWS.forEach(function(r){if(r.proj&&r.vday>=today()-730)c[r.proj]=(c[r.proj]||0)+1});INV.forEach(function(u){c[u.proj]=(c[u.proj]||0)+.001});return Object.keys(c).sort(function(a,b){return c[b]-c[a]})}
// everyone active in the last 400 days or in the picked period (visits, bookings or cancellations), plus the picked person
function personList(key,T){var c={},t=Math.min(today()-400,tab==="cmd"?today():period(F.per).from);if(F[key])c[F[key]]=1;ROWS.forEach(function(r){if(r[key]&&(r.vday>=t||r.bday>=t||r.cday>=t))c[r[key]]=(c[r[key]]||0)+1});T.forEach(function(x){c[x.m]=(c[x.m]||0)+1e6});return Object.keys(c).sort()}
function renderFilters(){
  setOpts($("fPer"),[["mtd","This month"],["lm","Last month"],["l30","Last 30 days"],["qtd","This quarter"],["fy","This FY to date"],["lfy","Last FY"],["l12","Last 12 months"],["all","All time"]].concat(recentMonths(18)),F.per);
  var pj=projList().map(function(p){return[p,lab(p)]});
  if(ALLOW){var AL=alw();if(AL)pj=pj.filter(function(o){return AL.has(o[0])})}
  if(tab==="site")pj=pj.filter(function(o){return o[0]!=="All"});
  $("fProj").style.display="none";$("mProj").style.display="";
  {var allN=alw()?"All my projects":"All projects",opt=pj.map(function(o){return o[0]});pSel(F.proj).forEach(function(p){if(opt.indexOf(p)<0)opt.push(p)});
    $("mProjB").innerHTML='<span>'+esc(F.proj?pName(F.proj):allN)+'</span>'+ic("chev")+'';$("mProjB").title=F.proj?lab(F.proj):allN;
    var act=document.activeElement&&document.activeElement.getAttribute?document.activeElement.getAttribute("data-mp"):null;
    $("mProjP").innerHTML='<label class="mop"><input type="checkbox" data-mp=""'+(F.proj?"":" checked")+'> <b>'+allN+'</b></label>'+opt.map(function(p){return'<label class="mop"><input type="checkbox" data-mp="'+esc(p)+'"'+(F.proj&&pHas(F.proj,p)?" checked":"")+'> '+esc(p==="All"?"No single project (“All”)":p)+'</label>'}).join("")+'<div class="mft"><button type="button" class="reset" id="mProjC">Clear</button><button type="button" class="reset" id="mProjD">Done</button></div>';
    if(act!=null){var back=[].filter.call($("mProjP").querySelectorAll("[data-mp]"),function(i){return i.getAttribute("data-mp")===act})[0];if(back)back.focus()}}

  setOpts($("fCm"),[["","All"]].concat(personList("cm",CT).map(function(x){return[x,x]})),F.cm);
  setOpts($("fSm"),[["","All"]].concat(personList("sm",ST).map(function(x){return[x,x]})),F.sm);
  setOpts($("fSrc"),[["","All"],["Direct","Direct"],["Indirect","Indirect (Channel Partner)"]].concat(uniq("src").filter(function(s){return!isCP(s)&&s!=="Direct"}).map(function(s){return[s,s]})),F.src);
  var P=period(F.per),ch=[];
  ch.push(tab==="cmd"?'<span class="chip" title="The Command Centre always looks at the latest days; the Period filter does not apply">Live · '+dl(today())+'</span>':'<span class="chip" title="Period">'+esc(P.label)+'</span>');
  [["proj","Project"],["cm","Closing"],["sm","Sourcing"],["src","Source"],["cp","CP firm"]].forEach(function(k){if(F[k[0]])ch.push('<button class="chip" data-x="'+k[0]+'" title="Remove filter">'+k[1]+': <b>'+esc(lab(F[k[0]]))+'</b> '+ic("x")+'</button>')});
  if(tab==="site"&&!F.proj)ch.splice(1,0,'<span class="chip"><b>'+esc(sLab())+'</b></span>');
  $("chips").innerHTML=ch.join("");
  var n=["proj","cm","sm","src","cp"].filter(function(k){return F[k]}).length;
  $("fopen").textContent="Filters"+(n?" ("+n+")":"");
}

/* ---------- tiles ---------- */
function tileData(id,P,S,PS,TG,ser){
  var m=M(id),o={m:m,st:"",sub:"",sub2:"",val:"",bar:null};
  if(m.ph){o.val="—";o.big="—";o.unit="";o.sub="Placeholder";o.sub2="Needs sale value per booking";return o}
  if(m.inv){var iv=inv(F.proj);o.val=fmt(iv.Unsold)+'<small>units</small>';o.sub=fp(pct(iv.Unsold,iv.tot),0)+" of "+fmt(iv.tot)+" unsold";o.sub2=fmt(iv["On hold"])+" on hold · "+fmt(iv.Sold)+" sold";o.big=fmt(iv.Unsold);o.unit="units unsold";return o}
  var v=m.v(S.tot),pv=PS?m.v(PS.tot):null;
  o.val=m.f(v)+(m.unit&&v!=null?'<small>'+m.unit+'</small>':"");o.big=m.f(v);o.unit=v!=null?m.unit||"":"";
  if(m.tgt){var a=achieve(ser,m.tgt==="book"?TG.bookM:TG.walkM,m.v);
    // when only some months of the period have a target, say which: the big number covers the whole period
    if(a){var span=a.ms.length<monthsIn(P).length?" · "+MN[a.ms[0]%100-1]+(a.ms.length>1?"–"+MN[a.ms[a.ms.length-1]%100-1]:""):"";o.sub=fmt(a.got)+" of "+fmt(a.tgt)+" target"+span;o.span=span.replace(/^ · /,"");o.st=a.st;o.bar={pc:a.pc,pace:a.pace};o.a=a}
    else o.noT=TG.why||"No target";
  }
  if(id==="net"){if(o.noT)o.sub=fmt(S.tot.gross)+" booked · "+fmt(S.tot.cx)+" cancelled";else o.sub2=fmt(S.tot.gross)+" booked · "+fmt(S.tot.cx)+" cancelled"}
  if(id==="conv")o.sub=S.tot.convNeg?"more cancellations than bookings":S.tot.convBad?"more bookings than tagged walk-ins":fmt(S.tot.net)+" net bookings ÷ "+fmt(S.tot.fresh)+" fresh";
  if(id==="rev")o.sub=S.tot.fresh?fp(pct(S.tot.rev,S.tot.fresh),0)+" of fresh walk-ins came back":"";
  if(id==="cx")o.sub=fp(pct(S.tot.cx,S.tot.gross),0)+" of bookings in period";
  if(id==="hot")o.sub="of "+fmt(S.tot.fresh)+" fresh walk-ins";
  if(id==="cpf")o.sub="sent "+fmt(S.tot.cpWalk)+" CP walk-ins";
  if(id==="sv"){var nv=S.tot.gross-S.tot.nAv;o.sub=S.tot.nAv?fcr(S.tot.av/S.tot.nAv)+" avg ticket":S.tot.gross?"No values entered":"No bookings";if(nv>0){o.sub+=" · "+nv+" booking"+(nv>1?"s have":" has")+" no agreement value";o.red=1}if(S.tot.avx)o.sub2=fcr(S.tot.avx)+" cancelled"}
  if(id==="nr"&&!m.ph){
    if(!pOne(F.proj)){var pr=nrByProj(P).list,ok3=pr.filter(function(x){return x.n>=3}),use=ok3.length?ok3:pr;
      if(use.length){var lo=Math.min.apply(null,use.map(function(x){return x.v})),hi=Math.max.apply(null,use.map(function(x){return x.v}));
        o.val=(use.length>1?rk(lo)+" – "+rk(hi):rs(lo))+"<small>/sq ft</small>";o.big=use.length>1?rk(lo)+" – "+rk(hi):rs(lo);o.unit="/sq ft";
        o.sub=use.length+" project"+(use.length>1?"s":"")+" · tap to see each";o.range=1}
      else{o.sub="No booking with value and carpet area"}}
    else o.sub=S.tot.nR?fmt(S.tot.nR)+" booking"+(S.tot.nR>1?"s":"")+" · after CP brokerage":"No booking with value and carpet area"}
  if(id==="tatb"){var nl=S.tot.tat.length;o.sub=nl?"median · "+fmt(nl)+" of "+fmt(S.tot.gross)+" bookings":"No linked bookings";o.st=v==null?"":v<=30?"good":v<=60?"warn":"bad"}
  if(id==="tat"){o.val=v==null?"–":m.f(v)+"<small>min</small>";o.sub=S.tot.wt.length?fp(pct(S.tot.wt15,S.tot.wt.length),0)+" waited over 15 min":TIME_OK?"No timed walk-ins in period":"Time In / Attended not readable yet";o.st=v==null?"":v<=15?"good":v<=30?"warn":"bad";o.sub2=fmt(S.tot.wt.length)+" of "+fmt(S.tot.fresh)+" timed"}
  var dt=deltaTxt(v,pv,m,PS&&PS.P);if(!o.sub2||!m.tgt||o.noT)o.sub2=dt;
  if(!o.sub){o.sub=o.sub2;o.sub2=tab==="mgmt"&&o.noT?o.noT:""}
  if(!o.st)o.st=deltaSt(v,pv,m);
  // money per sq ft moves a little every month: only a change of 5% or more gets a colour
  if(id==="nr"&&v!=null&&pv&&Math.abs(v-pv)/pv<.05)o.st="";
  // a range across projects has no single "previous" to compare with
  if(o.range){o.sub2="";o.st="";o.dt=""}
  o.dt=dt;o.pv=pv;o.v=v;if(o.range){o.dt="";o.sub2="";o.st="";o.val=o.val.replace(/^/,"<span class=\"rng\">").replace(/<small>/,"</span><small>")}
  if(id==="nr"&&!m.ph){if(o.range)o.sub2=o.sub;o.sub=sqf(S.tot.sqft)+" sold"}
  return o;
}
var TILEC={};
function renderTiles(ids,P,S,PS,TG,ser){
  var el=$("tiles");el.className="tiles"+(ids.length<=6?" six":"");el.style.setProperty("--n",ids.length);
  TILEC={P:P,S:S,PS:PS,o:{}};kpClose(false);
  el.innerHTML=ids.map(function(id,i){var o=tileData(id,P,S,PS,TG,ser);var c=METRICS.indexOf(o.m);TILEC.o[id]=o;
    // a tile with a target is the speedometer itself: title, dial, % read-out, and "achieved of target · months"
    if(o.bar)return'<div class="tile t'+c+' speedo'+(focus===id?" sel":"")+'" role="button" tabindex="0" data-tile="'+id+'" aria-pressed="'+(focus===id)+'" aria-label="'+esc(o.m.label)+': '+esc(o.sub)+'. Open details">'+si(o.st)+'<div class="tl"><span>'+esc(o.m.label)+'</span><button type="button" class="tinfo" data-info="'+id+'" aria-label="How '+esc(o.m.label)+' is calculated" aria-haspopup="dialog" aria-expanded="false" aria-controls="kpop"></button></div>'+speedo(o)+'</div>';
    return'<div class="tile t'+c+(o.m.ph?" ph":"")+(focus===id?" sel":"")+'" role="button" tabindex="0" data-tile="'+id+'" aria-pressed="'+(focus===id)+'" aria-label="'+esc(o.m.label)+': open details">'+si(o.st)+'<div class="tl"><span>'+esc(o.m.label)+'</span><button type="button" class="tinfo" data-info="'+id+'" aria-label="How '+esc(o.m.label)+' is calculated" aria-haspopup="dialog" aria-expanded="false" aria-controls="kpop"></button></div><div class="tv">'+o.val+'</div><div class="ts'+(o.red?" tred":"")+'">'+esc(o.sub)+'</div><div class="ts">'+esc(o.sub2)+'</div></div>'}).join("");
}
/* ---------- (i) formula popover ---------- */
var kpBtn=null,kpPinned=false,kpT=null,CAN_HOVER=matchMedia("(hover:hover) and (pointer:fine)");
function kpHtml(id){
  var o=TILEC.o[id],m=o.m,S=TILEC.S.tot,P=TILEC.P,PS=TILEC.PS,c=METRICS.indexOf(m),cols=["#E8432E","#4A4244","#9E1B22","#E07A64","#7A3034","#C2412F","#8C8183","#B9802F","#4A4244","#7A3034","#9C6A24","#3A3536"];
  var now="";
  if(id==="net")now='<b>'+fmt(S.gross)+'</b> booked − <b>'+fmt(S.cx)+'</b> cancelled = <b>'+fmt(S.net)+'</b>';
  else if(id==="fresh")now='<b>'+fmt(S.fresh)+'</b> fresh walk-ins';
  else if(id==="conv")now='(<b>'+fmt(S.gross)+'</b> booked − <b>'+fmt(S.cx)+'</b> cancelled) = <b>'+fmt(S.net)+'</b> net bookings ÷ <b>'+fmt(S.fresh)+'</b> fresh walk-ins = <b>'+m.f(S.conv)+'</b>';
  else if(id==="rev")now='<b>'+fmt(S.rev)+'</b> unique revisits'+(S.fresh?' — '+fp(pct(S.rev,S.fresh),0)+' of '+fmt(S.fresh)+' fresh walk-ins':"");
  else if(id==="cx")now='<b>'+fmt(S.cx)+'</b> cancelled'+(S.gross?' — '+fp(pct(S.cx,S.gross),0)+' of '+fmt(S.gross)+' bookings':"");
  else if(id==="tat")now=S.wt.length?"Half of <b>"+fmt(S.wt.length)+"</b> timed walk-ins waited <b>"+m.f(S.wtM)+" min</b> or less · <b>"+fmt(S.wt15)+"</b> waited over 15 min":"No walk-in in the period has both times filled";
  else if(id==="nr"&&!m.ph&&!pOne(F.proj)){var pl=nrByProj(P).list;now=pl.length?"Each project at its own rate (never blended): "+pl.map(function(x){return"<b>"+esc(x.p)+"</b> "+rs(x.v)+" ("+x.n+")"}).join(" · "):"No booking in the period has both agreement value and carpet area"}
  else if(id==="nr")now=m.ph?"Not available yet: connect Booking details":S.ca?"<b>"+fcr(S.avR)+"</b> ÷ <b>"+fmt(Math.round(S.ca))+"</b> sq ft = <b>"+m.f(S.rpsf)+"</b> per sq ft":"No booking in the period has both agreement value and carpet area";
  if(id==="nr"&&!m.ph)now+="<br>Sq ft sold: "+sqf(S.sf)+" booked − "+sqf(S.sfx)+" cancelled = <b>"+sqf(S.sqft)+"</b>"+(S.noCa?" ("+fmt(S.noCa)+" booking"+(S.noCa>1?"s have":" has")+" no carpet area)":"");
  else if(id==="sv")now="<b>"+fcr(S.av)+"</b> booked − <b>"+fcr(S.avx)+"</b> cancelled = <b>"+fcr(S.sv)+"</b> (₹"+fmt(Math.round(S.sv||0))+")";
  else if(id==="tatb")now=S.tat.length?"Half of <b>"+fmt(S.tat.length)+"</b> linked bookings closed within <b>"+Math.round(S.tatM)+" days</b> of the first visit · "+fmt(S.gross-S.tat.length)+" bookings have no matching walk-in":"No booking in the period matches a walk-in Form No";
  else if(id==="cpf")now='<b>'+fmt(S.ncp)+'</b> firms brought <b>'+fmt(S.cpWalk)+'</b> CP walk-ins';
  else if(id==="inv"){var iv=inv(F.proj);now='<b>'+fmt(iv.Unsold)+'</b> unsold of <b>'+fmt(iv.tot)+'</b> units ('+fp(pct(iv.Unsold,iv.tot),0)+') · '+fmt(iv["On hold"])+' on hold · '+fmt(iv.Sold)+' sold'}
  var st="";
  if(o.a){st='<div class="kst">'+si("good")+'<span>At or ahead of where you should be today</span>'+si("warn")+'<span>At 80–99% of that pace</span>'+si("bad")+'<span>Below 80% of that pace</span></div>'+
    '<div style="margin-top:6px">Now: <b>'+fmt(o.a.got)+' of '+fmt(o.a.tgt)+'</b> target = <b>'+fp(o.a.pc,0)+'</b>, against <b>'+fp(o.a.pace,0)+'</b> of the target period gone. On the gauge, the white arc is achieved and the dark tick is where you should be today.</div>'}
  else if(!m.inv&&PS){st='Compared with <b>'+esc(PS.P.label)+'</b>: '+si("good")+' better, '+si("bad")+' worse. '+(m.up<0?"For cancellations, <b>lower is better</b>.":"Higher is better.")+(m.tgt&&o.noT?" ("+esc(o.noT)+")":"")}
  var flt=m.ph?"Not live yet.":m.inv?"Only the Project filter applies; the period does not.":"Uses the Period, Project, Closing manager, Sourcing manager and Source filters.";
  return'<h3 id="kpopT"><i style="background:'+cols[c]+'"></i>'+esc(m.label)+'</h3><div class="kfx">'+esc(m.fx)+'</div><dl>'+
    (now?'<div><dt>Right now'+(m.inv?"":" ("+esc(P.label)+")")+'</dt><dd>'+now+'</dd></div>':"")+
    '<div><dt>What is counted</dt><dd>'+esc(m.def)+'</dd></div>'+
    (st?'<div><dt>Status icon</dt><dd>'+st+'</dd></div>':"")+
    '<div><dt>Filters</dt><dd>'+flt+'</dd></div></dl><button type="button" class="kclose" id="kclose">Got it</button>';
}
function kpOpen(btn,pin){
  clearTimeout(kpT);var pop=$("kpop"),id=btn.getAttribute("data-info"),sheet=isPhone()||!CAN_HOVER.matches;
  if(kpBtn&&kpBtn!==btn)kpBtn.setAttribute("aria-expanded","false");
  kpBtn=btn;kpPinned=pin||sheet;btn.setAttribute("aria-expanded","true");
  pop.innerHTML=kpHtml(id);pop.classList.toggle("pinned",kpPinned);pop.setAttribute("aria-modal",sheet?"true":"false");pop.hidden=false;$("kscrim").hidden=!sheet;
  if(!sheet){var r=btn.getBoundingClientRect(),w=pop.offsetWidth,h=pop.offsetHeight,x=Math.max(16,Math.min(window.innerWidth-w-16,r.left-16)),y=r.bottom+8;
    if(y+h>window.innerHeight-8&&r.top-h-8>8)y=r.top-h-8;pop.style.left=x+"px";pop.style.top=Math.max(8,y)+"px"}
  if(kpPinned)$("kclose").focus({preventScroll:true});
}
function kpClose(ret){clearTimeout(kpT);var pop=$("kpop");if(!pop||pop.hidden)return;pop.hidden=true;$("kscrim").hidden=true;
  if(kpBtn){kpBtn.setAttribute("aria-expanded","false");if(ret&&kpPinned&&document.body.contains(kpBtn))kpBtn.focus({preventScroll:true})}kpBtn=null;kpPinned=false}

// speedometer: dial 0–120% of target; zones follow where you would usually be by today (pace):
// red below 80% of pace, amber 80–100% of pace, green at or above pace; needle = achieved; white mark = pace
function gauge(pc,pace){
  var MAX=120,cx=50,cy=44,R=36,W=8,cl=function(p){return Math.max(0,Math.min(MAX,p))};
  function pt(p,r){var a=Math.PI*(1-cl(p)/MAX);return[(cx+r*Math.cos(a)).toFixed(2),(cy-r*Math.sin(a)).toFixed(2)]}
  function arc(a,b,cls){if(b-a<.3)return"";var p=pt(a,R),q=pt(b,R);return'<path class="'+cls+'" d="M'+p[0]+" "+p[1]+" A"+R+" "+R+" 0 0 1 "+q[0]+" "+q[1]+'" fill="none" stroke-width="'+W+'"/>'}
  var e=pace>0?pace:100,r80=Math.min(MAX,e*.8),r100=Math.min(MAX,e);
  var s='<svg class="gauge" viewBox="0 0 100 66" role="img" aria-label="'+Math.round(pc)+'% of target'+(pace<100?", usual by today "+Math.round(pace)+"%":"")+'">';
  s+=arc(0,MAX,"gt")+arc(0,r80,"gzr")+arc(r80,r100,"gza")+arc(r100,MAX,"gzg");
  // ticks every 25%, the 100% tick longer
  [0,25,50,75,100,120].forEach(function(t){var a=pt(t,R-W/2-1),b=pt(t,R-W/2-(t===100?7:4));s+='<line class="gtk'+(t===100?" big":"")+'" x1="'+a[0]+'" y1="'+a[1]+'" x2="'+b[0]+'" y2="'+b[1]+'"/>'});
  if(pace<100){var m1=pt(pace,R+W/2+3),m2=pt(pace,R-W/2);s+='<line class="gp" x1="'+m1[0]+'" y1="'+m1[1]+'" x2="'+m2[0]+'" y2="'+m2[1]+'"/>'}
  var n=pt(pc,R-9);
  s+='<line class="gn" x1="'+cx+'" y1="'+cy+'" x2="'+n[0]+'" y2="'+n[1]+'"/><circle class="gh" cx="'+cx+'" cy="'+cy+'" r="4.2"/>';
  s+='<text class="gx" x="'+cx+'" y="'+(cy+19)+'" text-anchor="middle">'+(pc>MAX?"&gt;":"")+Math.round(Math.min(pc,999))+'%</text></svg>';
  return s;
}

// full-tile speedometer: dial 0–120% of target, zones follow the usual pace by today, needle, % read-out under the hub
function speedo(o){
  var a=o.a,pc=a.pc,pace=a.pace,got=a.got,tgt=a.tgt,run=pace<100;
  // status: met > at or ahead of usual pace > within 80% of it > behind
  var k=pc>=100?"met":pc>=pace?"ok":pc>=pace*.8?"near":"low";
  var MAX=120,cx=100,cy=74,R=58,W=11,cl=function(p){return Math.max(0,Math.min(MAX,p))},ang=function(p){return cl(p)/MAX*180};
  function pt(p,r){var t=Math.PI*(1-cl(p)/MAX);return[+(cx+r*Math.cos(t)).toFixed(2),+(cy-r*Math.sin(t)).toFixed(2)]}
  var A0=pt(0,R),A1=pt(MAX,R),full="M"+A0[0]+" "+A0[1]+" A"+R+" "+R+" 0 0 1 "+A1[0]+" "+A1[1];
  var fillPc=cl(pc)/MAX*100,gid="sg"+o.m.id;
  var s='<svg class="spd s-'+k+'" viewBox="0 0 200 92" role="img" aria-label="'+fmt(got)+' of '+fmt(tgt)+' target, '+Math.round(pc)+'%'+(run?", usual by today "+Math.round(pace)+"%":"")+'" style="--a:'+ang(pc).toFixed(1)+'deg;--f:'+fillPc.toFixed(1)+'">';
  s+='<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="1" y2="0"><stop offset="0" class="g0"/><stop offset="1" class="g1"/></linearGradient></defs>';
  s+='<path class="trk" d="'+full+'" fill="none" stroke-width="'+W+'" stroke-linecap="round"/>';
  // minor ticks every 10%, inside the track
  for(var t=10;t<MAX;t+=10){if(t===100)continue;var p1=pt(t,R-W/2-3),p2=pt(t,R-W/2-(t%50?5:8));s+='<line class="tk'+(t%50?"":" mj")+'" x1="'+p1[0]+'" y1="'+p1[1]+'" x2="'+p2[0]+'" y2="'+p2[1]+'"/>'}
  if(pc>0)s+='<path class="fil" d="'+full+'" fill="none" stroke="url(#'+gid+')" stroke-width="'+W+'" stroke-linecap="round" pathLength="100" stroke-dasharray="'+fillPc.toFixed(1)+' 200"/>';
  // the target: a notch across the track and its number
  var q1=pt(100,R+W/2+5),q2=pt(100,R-W/2-6),ql=pt(100,R+W/2+9);
  s+='<line class="tgt" x1="'+q1[0]+'" y1="'+q1[1]+'" x2="'+q2[0]+'" y2="'+q2[1]+'"/><text class="tgl" x="'+(ql[0]+1)+'" y="'+(ql[1]-2)+'" text-anchor="start"><title>Target</title>'+fmt(tgt)+'</text>';
  // where you would usually be by today
  if(run){var u=ang(pace)*Math.PI/180,ux=cx-Math.cos(u)*(R+W/2+2),uy=cy-Math.sin(u)*(R+W/2+2),nx=-Math.cos(u),ny=-Math.sin(u),px=-ny,py=nx;
    s+='<path class="pace" d="M'+ux.toFixed(1)+" "+uy.toFixed(1)+" L"+(ux+nx*6+px*3.6).toFixed(1)+" "+(uy+ny*6+py*3.6).toFixed(1)+" L"+(ux+nx*6-px*3.6).toFixed(1)+" "+(uy+ny*6-py*3.6).toFixed(1)+'Z"><title>Usual by today: '+Math.round(pace)+'% of target</title></path>'}
  // tapered needle, drawn pointing at 0% and turned to the value (that turn is the one animation)
  s+='<g class="ndl"><path d="M'+(cx-R+16)+" "+cy+" L"+cx+" "+(cy-3.4)+" L"+(cx+9)+" "+cy+" L"+cx+" "+(cy+3.4)+'Z"/></g><circle class="hub" cx="'+cx+'" cy="'+cy+'" r="7"/><circle class="hubc" cx="'+cx+'" cy="'+cy+'" r="2.6"/>';
  s+='</svg>';
  var left=Math.max(0,tgt-got),chip=k==="met"?"Target met"+(got>tgt?" · +"+fmt(got-tgt):""):Math.round(pc)+"% · "+fmt(left)+" to go";
  return s+'<div class="sro"><b>'+fmt(got)+'</b><span>of '+fmt(tgt)+' target</span></div><div class="sch s-'+k+'">'+chip+(o.span?" · "+esc(o.span):"")+'</div>';
}
/* ---------- net realisation drill-down ---------- */
function rk(v){return"₹"+(v/1000).toFixed(1)+"k"}
// realisation per project for a period (and the previous period), never mixed across projects
function nrByProj(P){
  var FF=Object.assign({},F,{proj:pMulti(F.proj)?F.proj:""}),G={},GP={},PV=prevOf(P);
  nrRows(FF,P.from,Math.min(P.to,today())).forEach(function(r){if(!r.proj||r.proj==="All")return;(G[r.proj]||(G[r.proj]=[])).push(r)});
  if(PV)nrRows(FF,PV.from,PV.to).forEach(function(r){if(!r.proj||r.proj==="All")return;(GP[r.proj]||(GP[r.proj]=[])).push(r)});
  var list=Object.keys(G).map(function(p){var a=nrSum(G[p]),b=GP[p]?nrSum(GP[p]):{n:0,v:null};return{p:p,n:a.n,v:a.v,pn:b.n,pv:b.v}}).sort(function(a,b){return b.n-a.n});
  return{list:list,PV:PV};
}
function nrProjCard(P){
  var R=nrByProj(P),L=R.list;
  if(!L.length)return card("nrP","Realisation by project","","",empty("No booking in the period has both agreement value and carpet area"),"auto");
  var SA=stats(Object.assign({},F,{proj:pMulti(F.proj)?F.proj:""}),P,function(r){return r.proj}),sa=function(p){var g=SA.G[p];return g?g.sqft:0};
  var rows=L.map(function(x){var few=x.n<3,ch="";
    if(x.pv!=null&&x.v!=null&&x.n>=3&&x.pn>=3){var c=(x.v-x.pv)/x.pv*100;ch='<b class="'+(c<=-5?"lo":c>=5?"hi":"")+'">'+(c>=0?"▲ ":"▼ ")+Math.abs(c).toFixed(1)+'%</b>'}else ch='<span class="dim">–</span>';
    return drow("proj",x.p,'<td><b>'+esc(x.p)+'</b></td><td>'+(few?'<span class="dim" title="Fewer than 3 bookings">'+rs(x.v)+'</span>':rs(x.v))+'</td><td>'+(x.pv!=null?(x.pn<3?'<span class="dim">'+rs(x.pv)+'</span>':rs(x.pv)):'<span class="dim">–</span>')+'</td><td>'+ch+'</td><td>'+x.n+(few?' <span class="dim">too few</span>':"")+'</td><td>'+fmt(sa(x.p))+'</td>',false)}).join("");
  return card("nrP","Realisation by project",esc(P.label)+" · ₹ per sq ft after CP brokerage","",'<table class="nrtab"><thead><tr><th>Project</th><th>'+esc(P.label)+'</th><th>'+(R.PV?esc(cap(R.PV.label)):"Previous")+'</th><th>Change</th><th>Bookings</th><th>Sq ft sold</th></tr></thead><tbody>'+rows+'</tbody></table><div class="note"><b>'+sqf(SA.tot.sqft)+'</b> sold in total, after cancellations'+(SA.tot.noCa?" ("+fmt(SA.tot.noCa)+" booking"+(SA.tot.noCa>1?"s have":" has")+" no carpet area)":"")+'. Bookings = those used for the rate. Each project at its own rate; projects are never added together. Change shows only when both periods have 3+ bookings. Click a project to see its monthly trend.'+(RATE_OUT.length?" "+RATE_OUT.length+" bookings with a rate far from their project’s usual rate are left out (see Data checks).":"")+'</div>',"auto");
}
// bookings that count for realisation: not cancelled, with agreement value and carpet area
function nrRows(FF,from,to){return ROWS.filter(function(r){return r.bkRow&&!r.cx&&!r.rOut&&r.av>0&&r.carpet>0&&r.bday>=from&&r.bday<=to&&pass(r,FF)})}
function nrSum(list){var a=0,c=0;list.forEach(function(r){a+=netAV(r);c+=r.carpet});return{n:list.length,v:c?a/c:null}}
function rs(v){return v==null?"–":"₹"+fmt(Math.round(v))}
// monthly ₹/sq ft within the current filters: each point is that month's bookings only; months with 1–2 bookings are
// drawn hollow and faded (one unusual unit can move them), months with none show "–"; mix note when the mix moves
function nrTrendCard(P){
  var ms=monthsIn(P);if(ms.length>24)ms=ms.slice(-24);
  var pts=ms.map(function(k){var L=nrRows(F,monStart(k),Math.min(monEnd(k),today())),x=nrSum(L),c={};L.forEach(function(r){var key=(F.proj?"":r.proj+" ")+(r.cfg||"Not entered");c[key]=(c[key]||0)+1});
    var top="",tn=0;for(var q in c)if(c[q]>tn){tn=c[q];top=q}return{k:k,lab:ymLab(k),n:x.n,v:x.n?x.v:null,few:x.n>0&&x.n<3,top:top,share:x.n?tn/x.n:0}});
  var vals=pts.filter(function(p){return p.v!=null}).map(function(p){return p.v});
  if(!vals.length)return card("nrT","Net realisation by month","","",empty("No booking in these months has both agreement value and carpet area"),"auto");
  var lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals),pad=Math.max((hi-lo)*.25,hi*.02);lo-=pad;hi+=pad;
  var W=100,H=100,n=pts.length,x=function(i){return(i+.5)/n*W},y=function(v){return H-(v-lo)/(hi-lo)*H};
  var svg='<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="nrs">';
  // a segment touching a thin month is dashed
  for(var i=1;i<n;i++)if(pts[i].v!=null&&pts[i-1].v!=null)svg+='<line'+(pts[i].few||pts[i-1].few?' class="thin"':"")+' x1="'+x(i-1)+'" y1="'+y(pts[i-1].v)+'" x2="'+x(i)+'" y2="'+y(pts[i].v)+'"/>';
  svg+='</svg>';
  var lab=pts.map(function(p,i){var l=(x(i)).toFixed(2)+"%";
    return(p.v!=null?'<span class="nrd'+(p.few?" few":"")+'" style="left:'+l+';top:'+y(p.v).toFixed(1)+'%" title="'+esc(p.lab)+': '+rs(p.v)+' per sq ft over '+p.n+' booking'+(p.n>1?"s":"")+(p.few?" (too few to read as a trend)":"")+'"></span><span class="nrv'+(p.few?" few":"")+'" style="left:'+l+';top:'+y(p.v).toFixed(1)+'%">'+(p.v/1000).toFixed(1)+'k</span>':'<span class="nrnone" style="left:'+l+'" title="'+p.n+' bookings: too few">–</span>')+
      '<span class="nrx" style="left:'+l+'">'+esc(p.lab.replace(/ \d\d$/,""))+'<b class="'+(p.n<3?"few":"")+'">'+p.n+'</b></span>'}).join("");
  // mix note: the dominant project / configuration share moved a lot between the first and last valid windows
  var ok=pts.filter(function(p){return p.n>=3}),note="";
  if(!F.proj)note="All projects together: the project mix changes from month to month. Pick a project to compare like with like.";
  else if(ok.length>1){var f=ok[0],l=ok[ok.length-1];if(f.top!==l.top||Math.abs(f.share-l.share)>.25)note="The configuration mix shifted ("+esc(f.top)+" "+Math.round(f.share*100)+"% of bookings in "+esc(f.lab)+", "+esc(l.top)+" "+Math.round(l.share*100)+"% in "+esc(l.lab)+"), so part of the change is mix, not price."}
  return card("nrT","Net realisation by month","₹ per sq ft · after 2.25% CP brokerage","",
    '<div class="nrp">'+svg+lab+'</div><div class="nrk"><span>Number under each month = bookings that month</span><span><i class="nrhol"></i>1–2 bookings: read with care</span></div>'+(note?'<div class="nrnote">'+note+'</div>':""),"auto");
}
// like for like: project × configuration, direct vs indirect (after brokerage)
function nrMixCard(P){
  var L=nrRows(F,P.from,Math.min(P.to,today())),G={},all={d:[],i:[],a:[]};
  L.forEach(function(r){var k=(pOne(F.proj)?"":r.proj+"\u0001")+(r.cfg||"Not entered"),g=G[k]||(G[k]={d:[],i:[],a:[]});g.a.push(r);all.a.push(r);if(r.chan==="Indirect"){g.i.push(r);all.i.push(r)}else if(r.chan==="Direct"){g.d.push(r);all.d.push(r)}});
  if(!L.length)return card("nrM","Like for like","",'',empty("No booking in the period has both agreement value and carpet area"),"auto");
  var cell=function(list){var x=nrSum(list);return x.n?(x.n<3?'<span class="dim" title="'+x.n+' booking'+(x.n>1?"s":"")+': too few to judge">'+rs(x.v)+'</span>':rs(x.v))+'<small>'+x.n+'</small>':'<span class="dim">–</span>'};
  var gap=function(g){var d=nrSum(g.d),i=nrSum(g.i);if(d.n<3||i.n<3)return'<span class="dim">–</span>';var p=(i.v-d.v)/d.v*100;return'<b class="'+(p<-2?"lo":p>2?"hi":"")+'">'+(p>0?"+":"")+p.toFixed(1)+'%</b>'};
  var ks=Object.keys(G).sort(function(a,b){var pa=a.split("\u0001"),pb=b.split("\u0001");return pa.length>1&&pa[0]!==pb[0]?pa[0].localeCompare(pb[0]):G[b].a.length-G[a].a.length});
  var rows=ks.map(function(k){var g=G[k],p=k.split("\u0001");return'<tr><td>'+(p.length>1?'<b>'+esc(p[0])+'</b> · ':"")+esc(p[p.length-1])+'</td><td>'+cell(g.a)+'</td><td>'+cell(g.d)+'</td><td>'+cell(g.i)+'</td><td>'+gap(g)+'</td></tr>'}).join("");
  var D=nrSum(all.d),I=nrSum(all.i),gp=D.n&&I.n?(I.v-D.v)/D.v*100:null,unk=all.a.length-all.d.length-all.i.length;
  var head='<div class="nrcmp"><div><small>Direct</small><b>'+rs(D.v)+'</b><i>'+D.n+' bookings</i></div><div><small>Indirect (CP), after brokerage</small><b>'+rs(I.v)+'</b><i>'+I.n+' bookings</i></div><div class="'+(gp!=null&&gp<-2?"lo":"")+'"><small>Indirect vs direct</small><b>'+(gp==null?"–":(gp>0?"+":"")+gp.toFixed(1)+"%")+'</b><i>'+(gp==null?"":gp<0?"CP bookings earn less per sq ft":"CP bookings earn more per sq ft")+'</i></div></div>';
  return card("nrM","Like for like",esc(P.label)+(pOne(F.proj)?" · "+esc(F.proj):" · by project and configuration"),"",head+'<table class="nrtab"><thead><tr><th>'+(pOne(F.proj)?"Configuration":"Project · configuration")+'</th><th>All</th><th>Direct</th><th>Indirect</th><th>Gap</th></tr></thead><tbody>'+rows+'</tbody></table><div class="note">₹ per sq ft; small number = bookings. Grey = fewer than 3 bookings. Configuration from Booking details (AC). Direct or Indirect from Booking details column Q (Source Type); Indirect after 2.25% brokerage.'+(unk?" "+unk+" bookings with Source Type not set are in “All” only.":"")+'</div>',"auto");
}
/* ---------- management cards ---------- */
// long periods: group months into quarters (or years) so all history fits instead of cutting to the last 24 months
function groupSer(ser){
  if(ser.keys.length<=24)return null;
  var byQ=Math.ceil(ser.keys.length/3)<=24,g={},order=[],QL=["Jan–Mar","Apr–Jun","Jul–Sep","Oct–Dec"];
  ser.keys.forEach(function(k){var y=Math.floor(k/100),gk=byQ?y*10+Math.ceil((k%100)/3):y;
    if(!g[gk]){g[gk]={ks:[],s:blank()};order.push(gk)}var a=g[gk].s,b=ser.B[k];g[gk].ks.push(k);
    a.fresh+=b.fresh;a.rev+=b.rev;a.gross+=b.gross;a.cx+=b.cx;a.hot+=b.hot;a.cpWalk+=b.cpWalk;a.av+=b.av;a.avx+=b.avx;a.avR+=b.avR;a.ca+=b.ca;a.nR+=b.nR;Object.keys(b.cps).forEach(function(c){a.cps[c]=1});a.tat=a.tat.concat(b.tat)});
  return{unit:byQ?"quarter":"year",list:order.map(function(gk){var x=g[gk],yy=String(Math.floor(gk/10)).slice(2);fin(x.s);return{lab:byQ?"Q"+(gk%10)+" "+yy:String(gk),full:byQ?QL[gk%10-1]+" "+yy:String(gk),s:x.s,ks:x.ks}})};
}
function grpTarget(MM,ks){var sum=0,any=false;ks.forEach(function(k){if(MM&&MM[k]!=null){sum+=MM[k];any=true}});return any?sum:null}
function trendCard(P,TG,ser,weekly,id,mode,withTarget){
  var isB=mode==="book",grp=weekly?null:groupSer(ser);
  if(grp){var items=grp.list.map(function(gp){var s=gp.s,v=isB?s.net:s.fresh,t=withTarget?grpTarget(isB?TG.bookM:TG.walkM,gp.ks):null;
      return{lab:gp.lab,v:v,t:t,per:null,tip:gp.full+": "+(isB?fmt(s.net)+" net ("+fmt(s.gross)+" booked, "+fmt(s.cx)+" cancelled)":fmt(s.fresh)+" fresh walk-ins, "+fmt(s.rev)+" unique revisits")+(t!=null?" · target "+fmt(t):"")}});
    return{items:items,html:card(id,(isB?"Net bookings":"Fresh walk-ins")+" by "+grp.unit,withTarget&&(isB?TG.book!=null:TG.walk!=null)?"▬ target":"",togs(id==="cTrend"?"trend":"strend",[["book","Bookings"],["walk","Walk-ins"]],mode),'<div class="plot" style="position:absolute;inset:0"></div>',"chart")}}
  var items=ser.keys.map(function(k){var s=ser.B[k],v=isB?s.net:s.fresh,t=null;
    if(withTarget){if(weekly){var W=isB?TG.bookW:TG.walkW;t=W?W[k-1]:null}else{var MM=isB?TG.bookM:TG.walkM;t=MM[k]!=null?MM[k]:null}}
    var lb=weekly?"Wk "+k:ymLab(k);
    return{lab:lb,v:v,t:t,cur:!weekly&&k===ymOf(today()),per:weekly?null:"m"+k,tip:lb+": "+(isB?fmt(s.net)+" net ("+fmt(s.gross)+" booked, "+fmt(s.cx)+" cancelled)":fmt(s.fresh)+" fresh walk-ins, "+fmt(s.rev)+" unique revisits")+(t!=null?" · target "+fmt(t):"")+(weekly?"":" · click to open month")}});
  // achievement strip: only for months, and only when at least one month has a target
  var ach=!weekly&&withTarget&&items.some(function(it){return it.t>0});
  var sub=withTarget&&(isB?TG.book!=null:TG.walk!=null)?"▬ target":withTarget&&TG.why?esc(TG.why):"";
  return{items:items,ach:ach,html:card(id,(isB?"Net bookings":"Fresh walk-ins")+(weekly?" by week":" by month"),sub,togs(id==="cTrend"?"trend":"strend",[["book","Bookings"],["walk","Walk-ins"]],mode),ach?'<div class="plot" style="position:absolute;left:0;right:0;top:0;bottom:88px"></div><div class="achp" aria-label="Achievement against target by month"></div>':'<div class="plot" style="position:absolute;inset:0"></div>',"chart")};
}
function projCard(P){
  var S=stats(Object.assign({},F,{proj:""}),P,function(r){return r.proj}),iv=invBy("","proj");
  var keys=Object.keys(S.G).concat(Object.keys(iv).filter(function(k){return!S.G[k]}));
  keys=keys.filter(function(k,i){return keys.indexOf(k)===i});
  keys.sort(function(a,b){var x=S.G[a]||{net:0,fresh:0},y=S.G[b]||{net:0,fresh:0};return y.net-x.net||y.fresh-x.fresh});
  // with a project picked: show only it (default) or all projects with it pinned on top
  var sel=F.proj,all=sel&&ui.pcmp==="all";
  if(sel){var kin=keys.filter(function(k){return pHas(sel,k)});pSel(sel).forEach(function(k){if(kin.indexOf(k)<0)kin.push(k)});keys=all?kin.concat(keys.filter(function(k){return!pHas(sel,k)})):kin}
  var mx=0;keys.forEach(function(k){if(S.G[k])mx=Math.max(mx,S.G[k].net)});
  // booking target per project = Closing Targets rows tagged with it in column C, for the months of the period;
  // achievement counts net bookings only in the months where that same project has a target.
  // With a source, CP firm or sourcing manager filter the bookings are only a part, so they are not set against the full target.
  var noT=F.src||F.cp||F.sm,ms=monthsIn(P),PT={},PM={},tm=[],allT=0,NM={};
  if(!noT)CT.forEach(function(x){if(ms.indexOf(x.ym)<0||!(x.t>0))return;allT+=x.t;if(!F.cm||x.m===F.cm){PT[x.p]=(PT[x.p]||0)+x.t;(PM[x.p]=PM[x.p]||{})[x.ym]=1;if(tm.indexOf(x.ym)<0)tm.push(x.ym)}});
  tm.forEach(function(ym){NM[ym]=stats(Object.assign({},F,{proj:""}),{from:Math.max(P.from,monStart(ym)),to:Math.min(P.to,monEnd(ym))},function(r){return r.proj})});
  var netIn=function(k,m){return m.reduce(function(a,ym){var g=k===null?NM[ym].tot:NM[ym].G[k];return a+(g?g.net:0)},0)};
  var mons=function(k){return Object.keys(PM[k]).map(Number).sort()},paceOf=function(m){return achievePace(clip(P,m.slice()))};
  var monLab=function(m){return m.length>1?ymLab(m[0])+"–"+ymLab(m[m.length-1])+(monthsIn({from:monStart(m[0]),to:monEnd(m[m.length-1])}).length>m.length?" ("+m.length+" months)":""):ymLab(m[0])};
  var achCell=function(tg,a,m){var pc=a/tg*100,l=monLab(m);return'<td>'+fmt(tg)+'<small class="pjm">'+l+'</small></td><td title="'+fmt(a)+' net bookings in '+l+' against a target of '+fmt(tg)+'">'+pill(pc,stOf(pc,paceOf(m)))+'<small class="pjm">'+fmt(a)+' of '+fmt(tg)+'</small></td>'};
  var noCell='<td><span class="dim">–</span></td><td><span class="dim">–</span></td>',totT=0,totA=0;
  var achC=function(k){if(k==="All"||!(PT[k]>0))return noT?noCell:noCell.replace('class="dim"','class="dim" title="No target tagged to this project in column C"');return achCell(PT[k],netIn(k,mons(k)),mons(k))};
  var rows=keys.map(function(k){var s=S.G[k]||fin(blank()),u=iv[k];
    return drow("proj",k,'<td title="'+esc(lab(k))+'">'+esc(lab(k))+'</td><td>'+fmt(s.fresh)+'</td><td>'+fmt(s.net)+'</td>'+achC(k)+'<td>'+fp(s.conv)+'</td><td>'+(HAS_BK?(s.av>0?fcr(s.sv):s.gross?'<span class="dim" title="Bookings have no agreement value (column AH)">–</span>':'<span class="dim">–</span>'):u?fmt(u.Unsold)+'<span class="dim">/'+fmt(u.tot)+'</span>':'<span class="dim">–</span>')+'</td>',!!F.proj&&pHas(F.proj,k))}).join("");
  var t=sel&&!all?stats(F,P).tot:S.tot,ti=inv(sel&&!all?sel:"");
  // total row: the picked project, or the whole company against every target row (tagged or "All")
  // picked project(s): targets and results of each in its own months; otherwise the whole company over all target months
  var one=sel&&!all,tp=one?pSel(sel).filter(function(k){return k!=="All"&&PT[k]>0}):[],sumT=function(a,k){return a+PT[k]},ft=(one?tp:Object.keys(PT)).reduce(sumT,0),
    fm=one?tp.reduce(function(a,k){return a.concat(mons(k).filter(function(m){return a.indexOf(m)<0}))},[]).sort():tm.slice().sort(),fa=one?tp.reduce(function(a,k){return a+netIn(k,mons(k))},0):netIn(null,fm);
  var untag=noT?'<div class="note">Targets are set per closing manager and project, so they are not compared while a source, CP firm or sourcing manager is picked.</div>':PT.All>0&&!pOne(sel)?'<div class="note">'+fmt(PT.All)+' of the '+fmt(allT)+' booking target is not tagged to a project yet (column C says “All”), so project achievement shows “–”.</div>':"";
  var tg=sel?togs("pcmp",[["one",pMulti(sel)?"Selected only":esc(lab(sel))+" only"],["all","All projects"]],all?"all":"one"):"";
  return card("cProj","Projects",esc(P.label)+(sel&&!all?" · "+esc(pName(sel)):"")+(noT?" · targets hidden for this filter":""),tg,keys.length?'<table><thead><tr><th>Project</th><th>Fresh</th><th>Net bkg</th><th>Target</th><th>Achieved</th><th>Conv</th><th>'+(HAS_BK?"Sales value":"Unsold")+'</th></tr></thead><tbody>'+rows+'</tbody><tfoot><tr><td>'+(sel&&!all?(pMulti(sel)?"Selected total":esc(lab(sel))+" total"):"Total")+'</td><td>'+fmt(t.fresh)+'</td><td>'+fmt(t.net)+'</td>'+(ft?achCell(ft,fa,fm):noCell)+'<td>'+fp(t.conv)+'</td><td>'+(HAS_BK?fcr(t.sv):fmt(ti.Unsold)+'<span class="dim">/'+fmt(ti.tot)+'</span>')+'</td></tr></tfoot></table>'+untag:empty("No walk-ins in this period"));
}
// limit a period to the months that have targets, so actuals and targets cover the same months
function clip(P,tm){if(!tm.length)return P;tm.sort();var a=tm[0],b=tm[tm.length-1];return{from:Math.max(P.from,monStart(a)),to:Math.min(P.to,monEnd(b)),full:{to:monEnd(b)},label:a===b?ymLab(a):ymLab(a)+"–"+ymLab(b),clipped:monStart(a)>P.from||monEnd(b)<P.full.to}}
// manager tables: Net, walk-ins and conversion follow the picked period; achievement counts each person's results
// only in the months where that person has a target, and names those months
function tgLab(m){if(!m.length)return"";var a=m[0],b=m[m.length-1];return m.length>1?ymLab(a)+"–"+ymLab(b)+(monthsIn({from:monStart(a),to:monEnd(b)}).length>m.length?" ("+m.length+" months)":""):ymLab(a)}
function tgMonths(o,n){return Object.keys(o[n]||{}).map(Number).sort()}
function tgByMonth(FF,P,tm,keyFn){var o={};tm.forEach(function(ym){o[ym]=stats(FF,{from:Math.max(P.from,monStart(ym)),to:Math.min(P.to,monEnd(ym))},keyFn).G});return o}
function tgSum(NM,m,n,f){return m.reduce(function(a,ym){var g=NM[ym]&&NM[ym][n];return a+(g?g[f]:0)},0)}
function tgPace(P,m){return achievePace(clip(P,m.slice()))}
function tgAch(a,t,m,P){if(!(t>0))return'<td><span class="dim">–</span></td>';var pc=a/t*100,l=tgLab(m);return'<td title="'+fmt(a)+' in '+l+' against a target of '+fmt(t)+'">'+pill(pc,stOf(pc,tgPace(P,m)))+'<small class="pjm">'+fmt(a)+' of '+fmt(t)+'</small></td>'}
function closingCard(P){
  var FF=Object.assign({},F,{cm:""}),ms=monthsIn(P),noT=F.proj||F.src||F.cp||F.sm,T={},PM={},tm=[],key=function(r){return r.cm};
  if(!noT)CT.forEach(function(t){if(ms.indexOf(t.ym)<0||!(t.t>0))return;T[t.m]=(T[t.m]||0)+t.t;(PM[t.m]=PM[t.m]||{})[t.ym]=1;if(tm.indexOf(t.ym)<0)tm.push(t.ym)});
  tm.sort();
  var S=stats(FF,P,key),NM=tgByMonth(FF,P,tm,key);
  var names=Object.keys(T);Object.keys(S.G).forEach(function(k){if(k&&S.G[k].gross+S.G[k].cx>0&&names.indexOf(k)<0)names.push(k)});
  var list=names.map(function(n){var s=S.G[n]||fin(blank()),t=T[n]||0,m=tgMonths(PM,n),a=tgSum(NM,m,n,"net");return{n:n,s:s,t:t,m:m,a:a,pc:t?a/t*100:null}});
  list.sort(function(a,b){return(a.pc==null)-(b.pc==null)||(a.pc-b.pc)||b.s.net-a.s.net});
  // with a closing manager picked: show only them (default) or everyone with them pinned on top
  var sel=F.cm,all=sel&&ui.cmcmp==="all";
  if(sel){if(all)list=list.filter(function(x){return x.n===sel}).concat(list.filter(function(x){return x.n!==sel}));else list=list.filter(function(x){return x.n===sel})}
  var totT=0,totN=0,totF=0,totA=0,gapTot=0,mx=0;
  // total: every manager over all target months (one picked: their own months)
  var tmT=sel&&!all?tgMonths(PM,sel):tm;
  list.forEach(function(x){totT+=x.t;totN+=x.s.net;totF+=x.s.fresh;totA+=tgSum(NM,tmT,x.n,"net");if(x.t&&x.a<x.t)gapTot+=x.t-x.a;mx=Math.max(mx,noT||!tm.length?x.s.net:Math.max(x.t,x.t?x.a:0))});
  var rows=list.map(function(x){var gap=x.t&&x.a<x.t?x.t-x.a:0,st=x.pc==null?"":stOf(x.pc,tgPace(P,x.m));
    return drow("cm",x.n,'<td title="'+esc(lab(x.n))+'">'+esc(lab(x.n))+(x.t?'<small class="pjm">'+tgLab(x.m)+'</small>':"")+'</td><td>'+(x.t?fmt(x.t):'<span class="dim">–</span>')+'</td><td class="bar">'+(x.t?hbar(x.a,mx,st,x.t):noT||!tm.length?hbar(x.s.net,mx,"",null):"")+'</td>'+tgAch(x.a,x.t,x.m,P)+'<td>'+(gap?fmt(gap)+' <span class="dim">'+fp(pct(gap,gapTot),0)+'</span>':'<span class="dim">–</span>')+'</td><td>'+fmt(x.s.net)+'</td><td>'+fmt(x.s.fresh)+'</td><td title="Net bookings ÷ fresh walk-ins">'+convTxt(x.s.net,x.s.fresh)+'</td>',F.cm===x.n)}).join("");
  var sub=noT?"targets hidden for this filter":esc(P.label)+(tm.length?" · achieved is for target months only · worst first":"");
  var tgc=sel?togs("cmcmp",[["one",esc(lab(sel))+" only"],["all","All managers"]],all?"all":"one"):"";
  return card("cCm","Closing managers",sub,tgc,list.length?'<table><thead><tr><th>Manager</th><th>Target</th><th></th><th>Achieved</th><th>Gap (share)</th><th title="Net bookings in the picked period">Net</th><th>Fresh</th><th title="Net bookings ÷ fresh walk-ins">Conv</th></tr></thead><tbody>'+rows+'</tbody><tfoot><tr><td>'+(sel&&!all?esc(lab(sel))+" total":"Total")+(totT?'<small class="pjm">'+tgLab(tmT)+'</small>':"")+'</td><td>'+(totT?fmt(totT):"–")+'</td><td></td>'+tgAch(totA,totT,tmT,P)+'<td>'+(gapTot?fmt(gapTot):"–")+'</td><td>'+fmt(totN)+'</td><td>'+fmt(totF)+'</td><td>'+convTxt(totN,totF)+'</td></tr></tfoot></table>':empty("No closing data in this period"));
}
function achievePace(P){var e=P.full.to,s=P.from,t=today();return t>=e?100:Math.max(0,(t-s+1)/(e-s+1)*100)}
function sourcingCard(P){
  var FF=Object.assign({},F,{sm:""}),ms=monthsIn(P),noT=F.proj||F.src||F.cp||F.cm,TW={},TB={},PW={},PB={},tm=[],key=function(r){return r.sm};
  if(!noT)ST.forEach(function(t){if(ms.indexOf(t.ym)<0)return;
    if(t.t>0){TW[t.m]=(TW[t.m]||0)+t.t;(PW[t.m]=PW[t.m]||{})[t.ym]=1}
    if(t.b>0){TB[t.m]=(TB[t.m]||0)+t.b;(PB[t.m]=PB[t.m]||{})[t.ym]=1}
    if((t.t>0||t.b>0)&&tm.indexOf(t.ym)<0)tm.push(t.ym)});
  var S=stats(FF,P,key),NM=tgByMonth(FF,P,tm,key);
  var names=Object.keys(TW);Object.keys(TB).forEach(function(k){if(names.indexOf(k)<0)names.push(k)});
  Object.keys(S.G).forEach(function(k){if(k&&S.G[k].fresh+S.G[k].gross+S.G[k].cx>0&&names.indexOf(k)<0)names.push(k)});
  var list=names.map(function(n){var s=S.G[n]||fin(blank()),mw=tgMonths(PW,n),mb=tgMonths(PB,n);return{n:n,s:s,tw:TW[n]||0,tb:TB[n]||0,mw:mw,mb:mb,aw:tgSum(NM,mw,n,"fresh"),ab:tgSum(NM,mb,n,"net")}});
  list.sort(function(a,b){return(b.tw-a.tw)||(b.tb-a.tb)||(b.s.fresh-a.s.fresh)});
  // with a sourcing manager picked: show only them (default) or everyone with them pinned on top
  var sel=F.sm,all=sel&&ui.smcmp==="all";
  if(sel){if(all)list=list.filter(function(x){return x.n===sel}).concat(list.filter(function(x){return x.n!==sel}));else list=list.filter(function(x){return x.n===sel})}
  var plain=noT||!tm.length,mx=0;list.forEach(function(x){mx=Math.max(mx,plain?x.s.fresh:Math.max(x.tw,x.tw?x.aw:0))});
  var rows=list.map(function(x){var m=x.tw?x.mw:x.mb,l=tgLab(m),diff=x.tw&&x.tb&&tgLab(x.mb)!==l;
    return drow("sm",x.n,'<td title="'+esc(lab(x.n))+'">'+esc(lab(x.n))+(l?'<small class="pjm">'+l+(diff?" · bookings "+tgLab(x.mb):"")+'</small>':"")+'</td><td>'+fmt(x.s.fresh)+'</td><td class="bar">'+(x.tw?hbar(x.aw,mx,stOf(x.aw/x.tw*100,tgPace(P,x.mw)),x.tw):plain?hbar(x.s.fresh,mx,"",null):"")+'</td>'+tgAch(x.aw,x.tw,x.mw,P)+'<td>'+fmt(x.s.net)+'</td>'+tgAch(x.ab,x.tb,x.mb,P),F.sm===x.n)}).join("");
  return card("cSm","Sourcing managers",noT?"targets hidden for this filter":esc(P.label)+(tm.length?" · achieved is for target months only":""),sel?togs("smcmp",[["one",esc(lab(sel))+" only"],["all","All managers"]],all?"all":"one"):"",list.length?'<table><thead><tr><th>Manager</th><th title="Fresh walk-ins in the picked period">Walk-ins</th><th></th><th>Ach.</th><th title="Net bookings in the picked period">Bookings</th><th>Ach.</th></tr></thead><tbody>'+rows+'</tbody></table>':empty("No sourcing data in this period"));
}
function channelCard(P,mode,site){
  var FF=Object.assign({},F,{src:""}),body="";
  if(mode==="split"){
    var S=stats(FF,P,chOf),d=S.G.Direct||fin(blank()),n=S.G.Indirect||fin(blank());
    function line(k,a,b){var t=a+b;return'<div class="split"><span class="k">'+k+'</span><div class="stk" title="Direct '+fmt(a)+' · Indirect '+fmt(b)+'"><i class="c-dir" style="width:'+(t?a/t*100:0)+'%"></i><i class="c-ind" style="width:'+(t?b/t*100:0)+'%"></i></div><span class="v">'+fp(pct(b,t),0)+'</span></div>'}
    body='<div class="lg"><span><i class="c-dir"></i>Direct</span><span><i class="c-ind"></i>Indirect (CP)</span><span class="dim">right: indirect share</span></div>'+line("Walk-ins",d.fresh,n.fresh)+line("Bookings",d.net,n.net)+
      '<table style="margin-top:6px"><thead><tr><th>Channel</th><th>Fresh</th><th>Net bkg</th><th>Conv</th></tr></thead><tbody>'+[["Direct",d],["Indirect",n]].map(function(x){return drow("src",x[0],'<td>'+x[0]+'</td><td>'+fmt(x[1].fresh)+'</td><td>'+fmt(x[1].net)+'</td><td>'+fp(x[1].conv)+'</td>',F.src===x[0])}).join("")+'</tbody></table>'+
      '<div class="note">'+fmt(S.tot.ncp)+' channel-partner firms brought at least one walk-in.'+(S.G["Not set"]?' <b>'+fmt(S.G["Not set"].net)+'</b> net bookings have no valid Source Type (column Q) and are in neither row.':"")+' Bookings by Source Type (Booking details Q); walk-ins by Source (Walk-in Z).</div>';
  }else if(mode==="proj"){
    var S2=stats(Object.assign({},FF,{proj:""}),P,function(r){return r.proj+"\u0001"+chOf(r).charAt(0)}),pj={};
    for(var k in S2.G){var a=k.split("\u0001");pj[a[0]]=pj[a[0]]||{D:0,I:0,fd:0,fi:0};pj[a[0]][a[1]]+=S2.G[k].net;pj[a[0]]["f"+a[1].toLowerCase()]+=S2.G[k].fresh}
    var ks=Object.keys(pj).filter(function(k){return pj[k].D+pj[k].I+pj[k].fd+pj[k].fi>0}).sort(function(a,b){return(pj[b].D+pj[b].I)-(pj[a].D+pj[a].I)});
    body='<div class="lg"><span><i class="c-dir"></i>Direct</span><span><i class="c-ind"></i>Indirect</span><span class="dim">share of net bookings</span></div><table><thead><tr><th>Project</th><th></th><th>Indirect</th><th>Net</th></tr></thead><tbody>'+ks.map(function(k){var x=pj[k],t=x.D+x.I;
      return drow("proj",k,'<td>'+esc(lab(k))+'</td><td class="bar"><div class="stk"><i class="c-dir" style="width:'+(t?x.D/t*100:0)+'%"></i><i class="c-ind" style="width:'+(t?x.I/t*100:0)+'%"></i></div></td><td>'+fp(pct(x.I,t),0)+'</td><td>'+fmt(t)+'</td>',!!F.proj&&pHas(F.proj,k))}).join("")+'</tbody></table>';
  }else{
    // like Split and By project, the Source filter does not apply here
    var S3=stats(Object.assign({},F,{cp:"",src:""}),P,function(r){return isCP(r.src)?r.cp:"\u0000"});delete S3.G["\u0000"];
    var cps=Object.keys(S3.G).filter(function(k){return k}).sort(function(a,b){return S3.G[b].net-S3.G[a].net||S3.G[b].fresh-S3.G[a].fresh}).slice(0,15),mx=0;
    cps.forEach(function(k){mx=Math.max(mx,S3.G[k].fresh)});
    body=cps.length?'<table><thead><tr><th>CP firm</th><th>Fresh</th><th></th><th>Net bkg</th><th>Conv</th></tr></thead><tbody>'+cps.map(function(k){var s=S3.G[k];return drow("cp",k,'<td title="'+esc(k)+'">'+esc(k)+'</td><td>'+fmt(s.fresh)+'</td><td class="bar">'+hbar(s.fresh,mx)+'</td><td>'+fmt(s.net)+'</td><td>'+fp(s.conv)+'</td>',F.cp===k)}).join("")+'</tbody></table><div class="note">Top 15 by bookings. Click a firm to filter.'+(F.src&&F.src!=="Indirect"?" The Source filter is not applied to this list.":"")+'</div>':empty("No channel-partner walk-ins or bookings for this selection");
  }
  return card(site?"sSrcCard":"cChan",site?"Source & channel partners":"Direct vs Indirect","",togs(site?"ssrc":"chan",[["split","Split"],["proj","By project"],["cp","CP firms"]],mode),body);
}
var WHY=[["lost","Reason for lost"],["aff","Customer affinity"],["budget","Budget"],["cfg","Preferred config"],["area","Area (sq ft)"],["age","Age"],["loc","Location"],["city","City"],["purpose","Purpose"],["fund","Funding"],["cons","Construction status"],["emp","Employment"],["acc","Accompanied by"],["awv","Visit stage (AW)"],["bkvisit","Booked on fresh / revisit"],["wait","Waiting time"]];
function waitBand(w){return w<0?"":w<=15?"0–15 min":w<=30?"16–30 min":w<=60?"31–60 min":"Over 1 hour"}
function whyCard(P,dim,id){
  var key=dim==="wait"?function(r){return waitBand(r.wait)}:function(r){return r[dim]};
  var S=stats(F,P,key),visits=dim==="awv",bookingsOnly=dim==="bkvisit";
  var ks=Object.keys(S.G).filter(function(k){var s=S.G[k];return k!==""&&(visits?s.fresh+s.rev:bookingsOnly?s.gross:s.fresh)>0});
  var val=function(s){return visits?s.fresh+s.rev:bookingsOnly?s.gross:s.fresh};
  ks.sort(function(a,b){return val(S.G[b])-val(S.G[a])});
  var top=ks.slice(0,10),rest=ks.slice(10),mx=0,tot=0;ks.forEach(function(k){tot+=val(S.G[k])});top.forEach(function(k){mx=Math.max(mx,val(S.G[k]))});
  var blankN=S.G[""]?val(S.G[""]):0;
  var rows=top.map(function(k){var s=S.G[k],v=val(s);return'<tr><td title="'+esc(k)+'">'+esc(k)+'</td><td>'+fmt(v)+'</td><td class="bar">'+hbar(v,mx,"alt")+'</td><td>'+fp(pct(v,tot),0)+'</td>'+(bookingsOnly?"":'<td>'+fmt(s.net)+'</td><td>'+(visits?"–":fp(s.conv))+'</td>')+'</tr>'}).join("");
  if(rest.length){var o=0,og=0,of=0;rest.forEach(function(k){o+=val(S.G[k]);og+=S.G[k].net;of+=S.G[k].fresh});rows+='<tr><td class="dim">'+rest.length+' others</td><td>'+fmt(o)+'</td><td class="bar">'+hbar(o,mx,"alt")+'</td><td>'+fp(pct(o,tot),0)+'</td>'+(bookingsOnly?"":'<td>'+fmt(og)+'</td><td>'+(visits?"–":fp(pct(og,of)))+'</td>')+'</tr>'}
  var sel='<select data-why="'+id+'" aria-label="Breakdown">'+WHY.map(function(w){return'<option value="'+w[0]+'"'+(w[0]===dim?" selected":"")+'>'+w[1]+'</option>'}).join("")+'</select>';
  var h=visits?"Visits":bookingsOnly?"Bookings":"Fresh";
  return card(id,"Why","",'<div class="togs">'+sel+'</div>',ks.length?'<table><thead><tr><th>'+esc(WHY.filter(function(w){return w[0]===dim})[0][1])+'</th><th>'+h+'</th><th></th><th>Share</th>'+(bookingsOnly?"":'<th>Bkg</th><th>Conv</th>')+'</tr></thead><tbody>'+rows+'</tbody></table>'+(blankN?'<div class="note">'+fmt(blankN)+' not entered in the sheet (left out).</div>':""):empty("Nothing recorded for this in the period"));
}

/* ---------- site head cards ---------- */
function peopleCard(P,key,id,title){
  var FF=Object.assign({},F);FF[key]="";var S=stats(FF,P,function(r){return r[key]});
  var ks=Object.keys(S.G).filter(function(k){var s=S.G[k];return s.fresh+s.gross+s.rev>0}).sort(function(a,b){return S.G[b].net-S.G[a].net||S.G[b].fresh-S.G[a].fresh}),mx=0;
  var sel=F[key],uk=key+"cmp",all=sel&&ui[uk]==="all";
  if(sel){if(all)ks=ks.filter(function(k){return k===sel}).concat(ks.filter(function(k){return k!==sel}));else ks=ks.filter(function(k){return k===sel})}
  ks.forEach(function(k){mx=Math.max(mx,S.G[k].fresh)});
  var rows=ks.map(function(k){var s=S.G[k];return drow(key,k,'<td title="'+esc(lab(k))+'">'+esc(lab(k))+'</td><td>'+fmt(s.fresh)+'</td><td class="bar">'+hbar(s.fresh,mx)+'</td><td>'+fmt(s.rev)+'</td><td>'+fmt(s.net)+'</td><td>'+fp(s.conv)+'</td><td>'+fmt(s.hot)+'</td>',F[key]===k)}).join("");
  return card(id,title,"",sel?togs(uk,[["one",esc(lab(sel))+" only"],["all","All"]],all?"all":"one"):"",ks.length?'<table><thead><tr><th>Name</th><th>Fresh</th><th></th><th>Uniq. revisits</th><th>Net bkg</th><th>Conv</th><th>Hot</th></tr></thead><tbody>'+rows+'</tbody></table>':empty("No activity in this period"));
}
function siteSrcCard(P,mode){
  if(mode!=="src")return channelCard(P,mode==="split"?"split":"cp",true).replace(togs("ssrc",[["split","Split"],["proj","By project"],["cp","CP firms"]],mode==="split"?"split":"cp"),togs("ssrc",[["src","Source"],["cp","CP firms"]],mode));
  var FF=Object.assign({},F,{src:""}),S=stats(FF,P,function(r){return r.src}),ks=Object.keys(S.G).filter(function(k){return S.G[k].fresh+S.G[k].gross>0}).sort(function(a,b){return S.G[b].fresh-S.G[a].fresh}),mx=0;
  ks.forEach(function(k){mx=Math.max(mx,S.G[k].fresh)});
  var rows=ks.map(function(k){var s=S.G[k];return drow("src",k,'<td>'+esc(lab(k))+'</td><td>'+fmt(s.fresh)+'</td><td class="bar">'+hbar(s.fresh,mx,isCP(k)?"":"alt")+'</td><td>'+fmt(s.net)+'</td><td>'+fp(s.conv)+'</td>',!!k&&F.src===k)}).join("");
  return card("sSrcCard","Source & channel partners","",togs("ssrc",[["src","Source"],["cp","CP firms"]],mode),ks.length?'<table><thead><tr><th>Source</th><th>Fresh</th><th></th><th>Net bkg</th><th>Conv</th></tr></thead><tbody>'+rows+'</tbody></table>':empty("No walk-ins in this period"));
}
/* ---------- site head (phase A): records, team, CP scorecard, data to fix ---------- */
var HAS_NAMES=false,HAS_ID=false,TIME_OK=false,HAS_BK=false,REC_CTX=null,RATE_OUT=[];
// Form No as a matching key, same rule as the server: "INQ-02919" = "inq 2919" = "INQ2919"
var REC={fresh:"Fresh walk-ins",conv:"Fresh walk-ins · who booked",rev:"Unique revisits",net:"Booking register",cx:"Cancellations",tat:"Waiting time",nr:"Booking register · value",tatb:"Booking register · TAT"};
var AFC={"Hot":"hot","Warm High":"wh","Warm Low":"wl","Cold":"cold","Lost":"lost"};
function stLab(r){return r.cx||r.won===2?["Cancelled","cx"]:r.bk?["Booked "+(r.bday>0?dl(r.bday):""),"bk"]:r.won===1?["Booked "+(r.wonDay>0?dl(r.wonDay):""),"bk"]:r.aff==="Lost"?["Lost","lost"]:["Open","op"]}
function bkd(r){return(r.bk&&!r.cx)||r.won===1}
function convTxt(net,fresh){if(!fresh)return'<span class="dim" title="No fresh walk-ins">–</span>';if(net>fresh)return'<span class="dim" title="More bookings than walk-ins under this name, so the rate is not shown">–</span>';var v=fp(pct(net,fresh),0);return fresh<10?'<span class="dim" title="Only '+fresh+' fresh walk-ins: too few to judge">'+v+'</span>':v}
function rateTxt(net,fresh){return fresh<10?'<span class="dim" title="Fewer than 10 walk-ins: too few to judge">few</span>':fp(pct(net,fresh))}
function recRows(id,P){
  var out=[];
  for(var i=0;i<ROWS.length;i++){var r=ROWS[i];if(!pass(r,F))continue;var inV=r.vday>=P.from&&r.vday<=P.to;
    if(id==="fresh"||id==="conv"){if(inV&&r.kind===0)out.push(r)}
    else if(id==="rev"){if(inV&&r.uniq)out.push(r)}
    else if(id==="net"||id==="nr"||id==="tatb"){if(r.bk&&r.bday>=P.from&&r.bday<=P.to)out.push(r)}
    else if(id==="cx"){if(r.cx&&r.cday>=P.from&&r.cday<=P.to)out.push(r)}
    else if(id==="tat"){if(inV&&r.kind===0&&r.wait>=0)out.push(r)}}
  var dk=id==="net"||id==="nr"||id==="tatb"?"bday":id==="cx"?"cday":"vday",tb=function(r){var fv=r.fv>0?r.fv:r.vday;return fv>0&&r.bday>=fv?r.bday-fv:-1};
  out.sort(id==="tat"?function(a,b){return b.wait-a.wait||b.vday-a.vday}:id==="conv"?function(a,b){return(bkd(b)-bkd(a))||b.vday-a.vday}:id==="tatb"?function(a,b){return tb(b)-tb(a)}:id==="nr"?function(a,b){return(b.carpet>0?b.av/b.carpet:0)-(a.carpet>0?a.av/a.carpet:0)}:function(a,b){return b[dk]-a[dk]});
  return out;
}
function recPass(r,st,q){
  if(st==="open"&&(r.bk||r.won||r.aff==="Lost"))return false;
  if(st==="booked"&&!bkd(r))return false;
  if(st==="cx"&&!(r.cx||r.won===2))return false;
  if(st==="hot"&&!(r.aff==="Hot"||r.aff==="Warm High"))return false;
  if(st==="lost"&&r.aff!=="Lost")return false;
  if(q&&((r.id||"")+" "+(r.nm||"")+" "+(r.cp||"")).toLowerCase().indexOf(q)<0)return false;
  return true;
}
// day and month, plus the year when it is not this year ("12 Oct 25")
function dly(d){var y=ymd(d)[0];return dl(d)+(y!==ymd(today())[0]?" "+String(y).slice(2):"")}
function nmCell(r){return HAS_NAMES?(r.nm?esc(r.nm):'<span class="dim">–</span>'):'<span class="dim" title="Names show once the dashboard password is set">hidden</span>'}
function recListHtml(id,P){
  var q=(ui.rq||"").trim().toLowerCase(),st=ui.rst||"all",list=recRows(id,P).filter(function(r){return recPass(r,st,q)}),MAX=200;
  if(!list.length)return empty(q?"No customer matches “"+ui.rq+"”":id==="tat"&&!TIME_OK?"Time In and Time Attended cannot be read from the sheet yet, so waiting times are not available.":"No customers here for this period");
  var showWait=id==="tat",showLost=id==="cx"||st==="lost",showBk=HAS_BK&&(id==="net"||id==="nr"||id==="tatb"||id==="cx");
  var tbd=function(r){var fv=r.fv>0?r.fv:r.vday;return fv>0&&r.bday>=fv?r.bday-fv:null};
  var src=function(r){return isCP(r.src)?(r.cp||"CP · firm not entered"):(r.src||"–")};
  var many=!pOne(F.proj);
  var head='<tr><th>Form No</th>'+(many?'<th>Project</th>':"")+'<th>Customer</th><th>Visit</th><th>Source / CP firm</th><th>Config</th><th>Budget</th><th>Affinity</th><th>Closing</th><th>Sourcing</th>'+(showBk?'<th>Value</th><th>₹ / sq ft</th><th>TAT</th>':"")+(showWait?'<th>Wait</th>':"")+(showLost?'<th>Reason lost</th>':"")+'<th>Status</th></tr>';
  var body="",cards="";
  list.slice(0,MAX).forEach(function(r){var s=stLab(r),af=r.aff&&!r.bkRow?'<span class="rtag a-'+(AFC[r.aff]||"cold")+'">'+esc(r.aff)+'</span>':'<span class="dim">–</span>',vd=r.vday>0?dly(r.vday):r.fv>0?dly(r.fv):"–",tt=tbd(r),bkc=showBk?'<td>'+(r.av>0?fcr(r.av):"–")+'</td><td>'+(r.av>0&&r.carpet>0?"₹"+fmt(Math.round(r.av/r.carpet)):"–")+'</td><td>'+(tt==null?'<span class="dim" title="No matching walk-in">–</span>':tt+" d")+'</td>':"";
    body+='<tr><td class="fno">'+esc(r.id||"–")+'</td>'+(many?'<td>'+esc(r.proj&&r.proj!=="All"?r.proj:"–")+'</td>':"")+'<td class="rnm">'+nmCell(r)+'</td><td>'+vd+'</td><td class="rsrc" title="'+esc(src(r))+'">'+esc(src(r))+'</td><td>'+esc(r.cfg||"–")+'</td><td>'+esc(r.budget||"–")+'</td><td>'+af+'</td><td>'+esc(r.cm||"–")+'</td><td>'+esc(r.sm||"–")+'</td>'+bkc+(showWait?'<td><b'+(r.wait>15?' class="lo"':"")+'>'+r.wait+' min</b></td>':"")+(showLost?'<td>'+esc(r.lost||"–")+'</td>':"")+'<td><span class="rtag s-'+s[1]+'">'+esc(s[0])+'</span></td></tr>';
    cards+='<div class="rcard"><div class="rc1"><b>'+nmCell(r)+'</b>'+af+'</div><div class="rc2">'+(many&&r.proj&&r.proj!=="All"?esc(r.proj)+" · ":"")+esc(r.id||"")+(r.id?" · ":"")+vd+(r.cm?" · "+esc(r.cm):"")+'</div><div class="rc3"><span>'+esc(r.cfg||"–")+'</span><span>'+esc(r.budget||"–")+'</span><span>'+esc(src(r))+'</span>'+(showWait?'<span><b'+(r.wait>15?' class="lo"':"")+'>Waited '+r.wait+' min</b></span>':"")+(showLost&&r.lost?'<span>'+esc(r.lost)+'</span>':"")+(showBk&&r.av>0?'<span><b>'+fcr(r.av)+'</b>'+(r.carpet>0?" · ₹"+fmt(Math.round(r.av/r.carpet))+"/sq ft":"")+'</span>':"")+(showBk&&tt!=null?'<span>TAT '+tt+' d</span>':"")+'</div>'+(s[1]!=="op"?'<div class="rc4"><span class="rtag s-'+s[1]+'">'+esc(s[0])+'</span></div>':"")+'</div>'});
  return'<div class="rtbl"><table><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div><div class="rcards">'+cards+'</div>'+(list.length>MAX?'<div class="note">Showing the first '+MAX+' of '+fmt(list.length)+'. Search or pick a status to narrow the list.</div>':"");
}
function recHtml(id,P){
  REC_CTX={id:id,P:P};
  var base=recRows(id,P),st=ui.rst||"all";
  var cnt=function(k){var n=0;base.forEach(function(r){if(recPass(r,k,""))n++});return n};
  var bkList=id==="net"||id==="nr"||id==="tatb"||id==="cx";if(bkList&&st==="hot")st=ui.rst="all";
  var chips=[["all","All"],["open","Open"],["hot","Hot / Warm high"],["booked","Booked"],["cx","Cancelled"],["lost","Lost"]].filter(function(c){return!(bkList&&c[0]==="hot")}).map(function(c){var n=cnt(c[0]);return n||c[0]==="all"||c[0]===st?'<button class="rchip" data-ui="rst" data-uv="'+c[0]+'" aria-pressed="'+(st===c[0])+'">'+c[1]+' <b>'+fmt(n)+'</b></button>':""}).join("");
  var tw=id==="tat"&&base.length?'<div class="note">Half of these customers waited <b>'+Math.round(median(base.map(function(r){return r.wait})))+' min</b> or less; '+fmt(base.filter(function(r){return r.wait>15}).length)+' waited over 15 minutes. Longest waits first.</div>':"";
  if(id==="fresh"||id==="conv")tw+='<div class="note">Status is what the first-visit row says. Most bookings are recorded on a later revisit row, so the full list of bookings is in the Booking register (Net Bookings tile).</div>';
  var lock=HAS_NAMES?"Phone numbers, email and remarks are never loaded.":"Customer names show once the dashboard password is set (Vercel → Settings → Environment Variables → DASHBOARD_PASSWORD). Phone numbers, email and remarks are never loaded.";
  return'<section class="card rec"><div class="rhd"><button class="reset rback" data-unfocus>‹ Site Head</button><div><h2>'+esc(REC[id]||M(id).label)+' <span class="rn">'+fmt(base.length)+'</span></h2><div class="sub">'+esc(sLab())+' · '+esc(P.label)+(F.cm?' · '+esc(F.cm):"")+(F.sm?' · '+esc(F.sm):"")+(F.cp?' · '+esc(F.cp):"")+'</div></div></div>'+
    '<div class="rtools"><input class="rsearch" id="rq" type="search" autocomplete="off" placeholder="Search name, Form No or CP firm" value="'+esc(ui.rq||"")+'" aria-label="Search customers"><div class="rchips">'+chips+'</div></div>'+tw+
    '<div id="recList">'+recListHtml(id,P)+'</div><div class="rnote"><span aria-hidden="true">🔒</span> '+lock+'</div></section>';
}
// team: walk-ins, net bookings and cancellations at this project, against targets tagged to this project (column C)
function teamCard(P){
  var mode=ui.steam==="sm"?"sm":"cm",FF=Object.assign({},F);FF[mode]="";
  var ms=monthsIn(P),T={},tm=[];
  var inSel=function(q){return F.proj?q!=="All"&&pHas(F.proj,q):q==="All"?!ALLOW||!ALLOW.st:(!ALLOW||!ALLOW.st||ALLOW.st.has(q))};
  (mode==="cm"?CT:ST).forEach(function(t){if(inSel(t.p)&&ms.indexOf(t.ym)>=0){T[t.m]=(T[t.m]||0)+t.t;if(tm.indexOf(t.ym)<0)tm.push(t.ym)}});
  var hasT=Object.keys(T).length>0,PP=hasT?clip(P,tm):P,S=stats(FF,PP,function(r){return r[mode]}),pace=achievePace(PP);
  var names=Object.keys(T);Object.keys(S.G).forEach(function(k){var s=S.G[k];if(k&&(s.fresh+s.gross+s.cx+s.rev)>0&&names.indexOf(k)<0)names.push(k)});
  var list=names.map(function(n){var s=S.G[n]||fin(blank()),t=T[n]||0,got=mode==="cm"?s.net:s.fresh;return{n:n,s:s,t:t,got:got,pc:t?got/t*100:null}});
  list.sort(function(a,b){return(a.pc==null)-(b.pc==null)||(a.pc-b.pc)||b.got-a.got});
  var mx=0;list.forEach(function(x){mx=Math.max(mx,x.got,x.t)});
  var rows=list.map(function(x){var st=x.pc==null?"":stOf(x.pc,pace),s=x.s;
    return drow(mode,x.n,'<td title="'+esc(x.n)+'">'+esc(x.n)+'</td>'+(mode==="cm"?'<td>'+fmt(s.fresh)+'</td><td>'+fmt(s.net)+'</td>':'<td>'+fmt(s.fresh)+'</td>')+'<td>'+(x.t?fmt(x.t):'<span class="dim">–</span>')+'</td><td class="bar">'+hbar(x.got,mx,st,x.t||null)+'</td><td>'+pill(x.pc,st)+'</td>'+(mode==="cm"?'<td>'+rateTxt(s.net,s.fresh)+'</td><td>'+(s.cx?'<b class="lo">'+fmt(s.cx)+'</b>':"0")+'</td>':'<td>'+fmt(s.net)+'</td><td>'+rateTxt(s.net,s.fresh)+'</td>'),F[mode]===x.n)}).join("");
  var sheet=mode==="cm"?"Closing Targets":"Sourcing Targets",ml=ms.length===1?ymLab(ms[0])+" target is":"target for these months is";
  var note=hasT?(mode==="cm"?"Target = net bookings":"Target = fresh walk-ins")+" from "+sheet+(F.proj?" rows tagged "+sLab()+" in column C"+(pOne(F.proj)?"":", added together"):", every row of your projects, including company-wide (“All”) rows")+". Worst first.":"No "+ml+" tagged to "+sLab()+" yet. Put the project name in column C of the "+sheet+" sheet to see achievement here.";
  var head=mode==="cm"?'<th>Manager</th><th>Fresh</th><th>Net bkg</th><th>Target</th><th></th><th>Achieved</th><th>Conv</th><th>Cancelled</th>':'<th>Manager</th><th>Fresh</th><th>Target</th><th></th><th>Achieved</th><th>Net bkg</th><th>Conv</th>';
  return card("sTeam","Team",mode==="cm"?"closing managers":"sourcing managers",togs("steam",[["cm","Closing"],["sm","Sourcing"]],mode),(list.length?'<table><thead><tr>'+head+'</tr></thead><tbody>'+rows+'</tbody></table>':empty("No activity at this project in the period"))+'<div class="note">'+esc(note)+'</div>');
}
// channel partner scorecard: health numbers, top firms, and a watch list with reasons (last 90 days)
function cpOwner(FF){var o={};ROWS.forEach(function(r){if(!r.cp||!r.sm||!isCP(r.src)||r.vday<today()-365||!pass(r,FF))return;var a=o[r.cp]||(o[r.cp]={});a[r.sm]=(a[r.sm]||0)+1});
  var res={};for(var k in o){var b=o[k],best="",n=0;for(var s in b)if(b[s]>n){n=b[s];best=s}res[k]=best}return res}
function cpCard(P){
  var FF=Object.assign({},F,{cp:"",src:""}),all=stats(FF,P).tot;
  var G=stats(FF,P,function(r){return isCP(r.src)?(r.cp||"\u0002"):"\u0000"}).G,noFirm=G["\u0002"];delete G["\u0000"];delete G["\u0002"];
  var firms=Object.keys(G).filter(function(k){var s=G[k];return s.fresh+s.rev+s.gross+s.cx>0}),active=firms.filter(function(k){return G[k].fresh+G[k].rev>0});
  var cpFresh=noFirm?noFirm.fresh:0;firms.forEach(function(k){cpFresh+=G[k].fresh});
  var booked=firms.filter(function(k){return G[k].net>0}).length,byF=firms.slice().sort(function(a,b){return G[b].fresh-G[a].fresh}),top3=0;byF.slice(0,3).forEach(function(k){top3+=G[k].fresh});
  // new CP firm = its first-ever fresh walk-in at this site falls in the period (whole sheet history, any manager)
  var t3=cpFresh?top3/cpFresh*100:null,first={},FS={proj:F.proj},SEP="\u0001",prs={};
  ROWS.forEach(function(r){if(!r.cp||!isCP(r.src)||r.kind!==0||!(r.vday>0)||!r.proj||r.proj==="All"||!pass(r,FS))return;var k=r.cp+SEP+r.proj;prs[r.proj]=1;if(!(first[k]<=r.vday))first[k]=r.vday});
  var many=Object.keys(prs).length>1||pMulti(F.proj)||!F.proj,fm=function(k){return k.split(SEP)[0]},fp2=function(k){return k.split(SEP)[1]};
  var newF=Object.keys(first).filter(function(k){return first[k]>=P.from&&first[k]<=P.to}).sort(function(a,b){return first[a]-first[b]||a.localeCompare(b)});
  var nNew=newF.length,nPj={};newF.forEach(function(k){nPj[fp2(k)]=1});nPj=Object.keys(nPj).length;var PV=prevOf(P),pAct=null;
  if(PV){var GP=stats(FF,PV,function(r){return isCP(r.src)&&r.cp?r.cp:"\u0000"}).G;delete GP["\u0000"];pAct=Object.keys(GP).filter(function(k){return GP[k].fresh+GP[k].rev>0}).length}
  var own=cpOwner(FF);
  var k5=function(lb,v,sub,cls,btn){return(btn?'<button type="button" class="kb kbtn'+(cls?" "+cls:"")+'" '+btn+'>':'<div class="kb'+(cls?" "+cls:"")+'">')+'<small>'+lb+'</small><b>'+v+'</b><i>'+sub+'</i>'+(btn?'</button>':'</div>')};
  var strip='<div class="kstrip">'+k5("CP share of walk-ins",all.fresh?fp(pct(cpFresh,all.fresh),0):"–",fmt(cpFresh)+" of "+fmt(all.fresh)+" fresh")+
    k5("Active CP firms",fmt(active.length),pAct==null?"brought a walk-in":(active.length>=pAct?"▲":"▼")+Math.abs(active.length-pAct)+" vs "+esc(PV.label))+
    k5("Firms that booked",fmt(booked)+'<span> of '+fmt(active.length)+'</span>',fmt(Math.max(0,active.length-booked))+" with visits, no net booking")+
    k5("Top 3 firms' share",t3==null?"–":fp(t3,0),t3!=null&&t3>50?"Dependence risk: above 50%":"of CP walk-ins",t3!=null&&t3>50?"warn":"")+
    k5("New CP firms",fmt(nNew),nNew?(ui.cpnew?"Hide the list ▴":(many?"new at a site, "+nPj+" project"+(nPj>1?"s":"")+" · see list ▾":"First fresh walk-in here · see list ▾")):"first fresh walk-in here",ui.cpnew?"on":"",nNew?'data-cpnew="1" aria-expanded="'+!!ui.cpnew+'"':"")+'</div>';
  if(ui.cpnew&&nNew){var GN=stats(Object.assign({},FF,{cm:"",sm:""}),P,function(r){return isCP(r.src)&&r.cp?r.cp+SEP+r.proj:"\u0000"}).G;
    strip+='<div class="cpnew"><h3 class="lh">New CP firms <span>first-ever fresh walk-in '+(many?'at each project':'at '+esc(sLab()))+' in '+esc(P.label)+', earliest first</span></h3><table><thead><tr><th>CP firm</th>'+(many?'<th>Project</th>':'')+'<th>First walk-in</th><th>Fresh</th><th>Net bkg</th><th>Sourcing</th></tr></thead><tbody>'+
      newF.map(function(k){var s=GN[k]||{fresh:0,net:0},n=fm(k);return drow("cp",n,'<td title="'+esc(n)+'"><b>'+esc(n)+'</b></td>'+(many?'<td>'+esc(fp2(k))+'</td>':'')+'<td style="white-space:nowrap">'+dl(first[k])+(P.to-P.from>40?" '"+String(ymd(first[k])[0]).slice(2):"")+'</td><td>'+fmt(s.fresh)+'</td><td>'+fmt(s.net)+'</td><td class="dim">'+esc(own[n]||"–")+'</td>')}).join("")+
      '</tbody></table><div class="note">Fresh and Net bkg are for '+esc(P.label)+'. Sourcing = the manager who handles most of the firm’s walk-ins. '+(many?'A firm new at two projects is listed once for each. ':'')+'A firm spelled two ways counts twice; the sheet’s first month counts every firm as new.</div></div>'}
  var top=firms.filter(function(k){return G[k].fresh+G[k].gross>0}).sort(function(a,b){return G[b].net-G[a].net||G[b].fresh-G[a].fresh}).slice(0,8);
  var topT=top.length?'<table><thead><tr><th>#</th><th>CP firm</th><th>Fresh</th><th>Net bkg</th><th>Rate</th><th>Sourcing</th></tr></thead><tbody>'+top.map(function(k,i){var s=G[k];return drow("cp",k,'<td class="dim">'+(i+1)+'</td><td title="'+esc(k)+'"><b>'+esc(k)+'</b></td><td>'+fmt(s.fresh)+'</td><td><b>'+fmt(s.net)+'</b></td><td>'+rateTxt(s.net,s.fresh)+'</td><td class="dim">'+esc(own[k]||"–")+'</td>',F.cp===k)}).join("")+'</tbody></table>':empty("No channel-partner walk-ins in this period");
  // watch list over the last 90 days, so one quiet week does not mark a firm
  var t0=today(),A={},totF=0,totN=0,GE=/general|dropped|not interested|no requirement|just enquir|fake|wrong/i;
  ROWS.forEach(function(r){if(!r.cp||!isCP(r.src)||!pass(r,FF))return;var a=A[r.cp]||(A[r.cp]={f:0,g:0,c:0,ge:0,lost:0,prev:0,last:0,cm:{},un:0}),v=r.vday;
    if(v>=t0-89&&v<=t0&&r.kind===0){a.f++;if(r.aff==="Lost"){a.lost++;if(GE.test(r.lost))a.ge++}if(!r.bk&&!r.won){a.un++;if(r.cm)a.cm[r.cm]=(a.cm[r.cm]||0)+1}}
    if(r.bk&&r.bday>=t0-89&&r.bday<=t0)a.g++;
    if(r.cx&&r.cday>=t0-89&&r.cday<=t0)a.c++;
    if((r.kind===0||r.uniq)&&v>=t0-74&&v<=t0-30)a.prev++;
    if((r.kind===0||r.uniq)&&v>t0-30&&v<=t0)a.last++});
  for(var k in A){totF+=A[k].f;totN+=A[k].g-A[k].c}
  var avg=totF?totN/totF:0,W=[];
  for(k in A){var a=A[k],net=a.g-a.c,f=null;
    if(a.f>=10&&a.g===0)f=[1,"bad","No booking from "+a.f+" walk-ins"];
    else if(a.lost>=5&&a.ge/a.f>=.4)f=[2,"bad",a.ge+" of "+a.f+" lost as general enquiry or dropped"];
    else if(a.g>=2&&a.c/a.g>=.5)f=[3,"bad",a.c+" of "+a.g+" bookings cancelled"];
    else if(a.f>=10&&net>0&&net/a.f<avg/2)f=[4,"warn","Booking rate "+fp(net/a.f*100)+" vs "+fp(avg*100)+" average"];
    else if(a.prev>=3&&a.last===0)f=[5,"warn","Gone quiet: "+a.prev+" walk-ins before, none in 30 days"];
    if(!f)continue;
    var who="";if(f[0]<=2&&a.un>=5){var bc="",bn=0;for(var c in a.cm)if(a.cm[c]>bn){bn=a.cm[c];bc=c}if(bn/a.un>=.6)who=Math.round(bn/a.un*100)+"% of unbooked handled by "+bc}
    W.push({k:k,a:a,net:net,f:f,who:who})}
  W.sort(function(x,y){return x.f[0]-y.f[0]||y.a.f-x.a.f});
  var nW=W.length;W=W.slice(0,8);
  var watchT=W.length?'<table class="cpw"><thead><tr><th>CP firm</th><th>Fresh</th><th>Net bkg</th><th>Why flagged</th><th>Owner</th></tr></thead><tbody>'+W.map(function(x){return drow("cp",x.k,'<td title="'+esc(x.k)+'"><b>'+esc(x.k)+'</b></td><td>'+fmt(x.a.f)+'</td><td>'+fmt(x.net)+'</td><td><span class="cpflag '+x.f[1]+'">'+esc(x.f[2])+'</span>'+(x.who?'<div class="note" style="margin:2px 0 0">'+esc(x.who)+'</div>':"")+'</td><td class="dim">'+esc(own[x.k]||"–")+'</td>',F.cp===x.k)}).join("")+'</tbody></table>'+(nW>8?'<div class="note">+ '+(nW-8)+' more firms flagged.</div>':""):'<div class="okmsg">No CP firm meets a warning rule in the last 90 days.</div>';
  var rules="Flags (last 90 days): 10+ walk-ins and no booking · 40%+ of walk-ins lost as general enquiry or dropped (5+ lost) · half or more of bookings cancelled · booking rate under half the average (10+ walk-ins) · gone quiet (3+ walk-ins in the 45 days before, none in the last 30). When most unbooked walk-ins sit with one closing manager, it is said, so the firm is not blamed for a follow-up gap.";
  return card("sCp","Channel partner scorecard",esc(P.label)+" · click a firm to filter the page","",strip+'<div class="cpgrid"><div><h3 class="lh good">▲ Top CP firms <span>by net bookings, then walk-ins</span></h3>'+topT+'</div><div><h3 class="lh bad">▼ Watch list <span>last 90 days, with the reason</span></h3>'+watchT+'</div></div><div class="note">'+rules+'</div>',"auto");
}
// Booking details against Walk-in: things to check, worst first. Nothing here changes a figure.
var DSC=[["nodate","Left out: Booking Date blank or unreadable","Not counted as a booking until column AN is filled. Shown for every period."],["nostatus","Left out: Overall Status blank","Not counted until column Y is filled. Shown for every period."],["srcbad","Source Type is not Direct or Indirect","Counts in the total, but in neither channel. Correct column Q."],["cpmissing","Indirect, but CP name missing","Counts as Indirect. Fill column R."],["dirfirm","Direct, but a CP name is entered","Counts as Direct. Correct column Q or clear column R."],["noform","No Form No in Booking details","Fill column B. No TAT until then."],["noval","Agreement value (column AH) blank","Counted as a booking, but adds nothing to sales value and average ticket. Fill column AH."],["otherproj","Form No found only at another project","No walk-in at this project with that Form No, so it has no Booking TAT."],["notfound","Form No not in the Walk-in sheet","Correct column B, or add the walk-in."],["late","Walk-in is dated after the booking","Check the Form No or the dates. Left unmatched, so no TAT."],["revisit","Only revisits before the booking, no fresh walk-in","Check column AW in Walk-in."],["check","Form No used more than once, customer not certain","Names are blank or only similar, so the latest fresh walk-in is used."],
  ["multi","Same Form No on more than one booking","Two flats, or a wrong Form No?"],["dup","Entered twice on the same booking date","Check for hidden or filtered rows."],["status","Left out: Overall Status is not one of the two values","Only “Directly Booked” and “Cancelled at Booking” count. Correct column Y."],["future","Booking or cancellation date after today","Counted only once that date arrives. Check columns AN and V."],["badnum","Value or carpet area cannot be read","Counted as a booking with that figure as 0. Type a plain number in AH (₹) or AD (sq ft)."],["cxnodate","Cancelled, but no cancellation date","Fill column V. Counted on the booking date until then."],["cxbefore","Cancelled before it was booked","Correct column V or AN."],["blank","Blank in Booking details","Not filled from the Walk-in sheet any more."],
  ["cpblank","Direct booking, but the walk-in came from a CP","The booking keeps column Q."],["cpwalk","Indirect booking, but the walk-in is not from a CP","The booking keeps column Q."],["cpdiff","Different CP firm","The booking keeps column R."],["cm","Different closing manager","The booking keeps column T."],["cmspell","Closing manager spelled differently","Use one spelling in both sheets."],["proj","Different project","May be fine: a customer can visit one project and book another."]];
function discCard(P){
  if(!HAS_BK)return"";
  var A=ALLOW&&(alw()),L=(DATA.DISC||[]).filter(function(x){return(x.bday<0||x.t==="future"||x.bday>=P.from&&x.bday<=P.to)&&(!F.proj||pHas(F.proj,x.p))&&!(A&&!A.has(x.p))}),G={};
  L.forEach(function(x){(G[x.t]=G[x.t]||[]).push(x)});
  var body=DSC.filter(function(d){return G[d[0]]}).map(function(d){var l=G[d[0]].sort(function(a,b){return b.bday-a.bday}),two=l.some(function(x){return x.w}),one=l.some(function(x){return x.b});
    return'<details class="dsc'+(d[0]==="noval"?" red":"")+'"><summary><b>'+d[1]+'</b><span>'+d[2]+'</span><span class="dn">'+fmt(l.length)+'</span></summary><div class="dtb"><table><thead><tr><th>Form No</th><th>Sheet row</th><th>Project</th><th>Booked</th><th>Status</th>'+(one||two?'<th>Booking details</th>':"")+(two?'<th>Walk-in</th>':"")+'</tr></thead><tbody>'+l.map(function(x){return'<tr><td class="fno">'+esc(x.id||"–")+'</td><td>'+(x.row||"–")+'</td><td>'+esc(x.p||"–")+'</td><td>'+(x.bday>0?dly(x.bday):"–")+'</td><td>'+(x.cx?"Cancelled":"Booked")+'</td>'+(one||two?'<td>'+esc(x.b||"–")+'</td>':"")+(two?'<td>'+esc(x.w||"–")+'</td>':"")+'</tr>'}).join("")+'</tbody></table></div></details>'}).join("");
  return card("sDisc","Booking details vs Walk-in",L.length?fmt(L.length)+" to check · bookings in "+esc(P.label):"","",body?'<div class="note" style="margin:0 0 8px">Bookings are counted from Booking details only. These are differences to check. One booking can be in more than one list.</div>'+body:empty("Nothing to check for bookings in this period"),"auto");
}
// data to fix: blank fields on this project's fresh walk-ins, by closing manager; plus sheet-wide issues
function fixCard(P){
  // operational fields decide which rows must be fixed; profile fields (age, employment...) are shown as completeness only
  var FX=[["src","Source"],["cp","CP firm"],["cm","Closing manager"],["sm","Sourcing manager"],["aff","Affinity"],["lost","Lost reason"]];
  if(TIME_OK)FX.push(["time","Time in / attended"]);if(HAS_ID)FX.push(["id","Form No"]);
  var PROF=[["age","Age"],["emp","Employment"],["acc","Accompanied by"],["loc","Location"],["budget","Budget"],["cfg","Configuration"]];
  var NAME={};FX.forEach(function(f){NAME[f[0]]=f[1]});
  var fill={},den={},list=[],byM={};FX.concat(PROF).forEach(function(f){fill[f[0]]=0;den[f[0]]=0});
  ROWS.forEach(function(r){if(r.kind!==0||r.vday<P.from||r.vday>P.to||!pass(r,F))return;var miss=[];
    function ck(k,ok,applies){if(applies===false)return;den[k]++;if(ok)fill[k]++;else miss.push(k)}
    ck("src",!!r.src);ck("cp",!!r.cp,isCP(r.src));ck("cm",!!r.cm);ck("sm",!!r.sm);ck("aff",!!r.aff);ck("lost",!!r.lost,r.aff==="Lost");if(TIME_OK)ck("time",r.wait>=0);if(HAS_ID)ck("id",!!r.id);
    PROF.forEach(function(p){den[p[0]]++;if(r[p[0]])fill[p[0]]++});
    if(miss.length){list.push({r:r,miss:miss});var m=r.cm||"No closing manager";byM[m]=(byM[m]||0)+1}});
  var bars=FX.concat([["-","Customer profile (for later)"]]).concat(PROF).filter(function(f){return f[0]==="-"||den[f[0]]}).map(function(f){if(f[0]==="-")return'<div class="fxsep">'+f[1]+'</div>';var pc=fill[f[0]]/den[f[0]]*100,c=pc>=90?"good":pc>=75?"warn":"bad";return'<div class="fxb"><span>'+f[1]+'</span>'+hbar(pc,100,c)+'<b class="'+(c==="good"?"":c==="warn"?"wn":"lo")+'">'+fp(pc,0)+'</b></div>'}).join("");
  list.sort(function(a,b){return(a.r.cm||"~").localeCompare(b.r.cm||"~")||b.r.vday-a.r.vday});
  var SHOW=ui.fixall?400:25;
  var rows=list.slice(0,SHOW).map(function(x){var r=x.r;return'<tr><td class="fno">'+esc(r.id||"–")+'</td><td class="rnm">'+nmCell(r)+'</td><td>'+(r.vday>0?dl(r.vday):"–")+'</td><td>'+esc(r.cm||"–")+'</td><td>'+x.miss.map(function(m){return'<span class="miss">'+NAME[m]+'</span>'}).join("")+'</td></tr>'}).join("");
  var mgr=Object.keys(byM).sort(function(a,b){return byM[b]-byM[a]}).map(function(m){return esc(m)+" "+byM[m]}).join(" · ");
  // sheet-wide issues the site head should raise
  var iss=[],q=DATA.Q||{},noProj=0,tot=0;
  ROWS.forEach(function(r){if(r.kind!==0||r.vday<P.from||r.vday>P.to)return;tot++;if(!r.proj||r.proj==="All")noProj++});
  if(noProj)iss.push("<b>"+fmt(noProj)+" of "+fmt(tot)+"</b> fresh walk-ins in "+esc(P.label)+" have no project in column B, so no Site Head sees them.");
  var bkAll=0;ROWS.forEach(function(r){if(r.bk)bkAll++});
  if(!HAS_BK&&q.bookingNoDate&&bkAll&&q.bookingNoDate/bkAll>.2)iss.push("<b>"+fmt(q.bookingNoDate)+" of "+fmt(bkAll)+"</b> bookings have no Booking Date, so they are counted on the visit date.");
  if(HAS_BK){var ub=ROWS.filter(function(r){return r.bkRow&&!r.linked&&r.bday>=P.from&&r.bday<=P.to&&pass(r,F)});
    if(ub.length){var nb0=ub.filter(function(r){return!r.id}).length,wid=ub.filter(function(r){return r.id});
      iss.push("<b>"+fmt(ub.length)+"</b> booking"+(ub.length>1?"s":"")+" in Booking details "+(ub.length>1?"have":"has")+" no matching walk-in"+(nb0?": <b>"+fmt(nb0)+"</b> with no Form No (column B)":"")+(wid.length?(nb0?"; ":": ")+"Form No with no walk-in on or before the booking: "+wid.slice(0,6).map(function(r){return esc(r.id)}).join(", ")+(wid.length>6?" and "+(wid.length-6)+" more":""):"")+".")}}
  if(HAS_BK){var cb=0,tf=0;ROWS.forEach(function(r){if(r.bkRow&&r.bday>=P.from&&r.bday<=P.to&&pass(r,F)&&!r.cx)cb++;if(r.kind===0&&r.vday>=P.from&&r.vday<=P.to&&pass(r,F))tf++});
    if(cb>tf)iss.push("<b>"+fmt(cb)+"</b> bookings but only <b>"+fmt(tf)+"</b> fresh walk-ins tagged "+esc(sLab())+" in "+esc(P.label)+", so the walk-in to booking rate can’t be shown. Tag column B for this project’s walk-ins.")}
  var tc=Object.keys(q.tgtCombined||{});
  if(tc.length)iss.push("Target sheets have several projects in one cell of column C ("+tc.slice(0,4).map(function(s){return"“"+esc(s)+"”"}).join(", ")+(tc.length>4?" and "+(tc.length-4)+" more":"")+"). These targets are counted in the company total only, not under any project. Put one project per row to see them project-wise.");
  if(!TIME_OK)iss.push("Time In and Time Attended could not be read for any walk-in, so TAT is not shown yet. If these columns are filled, their format or position needs a look.");
  if(q.cpVariants&&q.cpVariants.length)iss.push("CP firm names typed in different ways were merged: "+q.cpVariants.slice(0,3).map(function(v){return"“"+esc(v.as[0])+"” → "+esc(v.firm)}).join(", ")+(q.cpVariants.length>3?" and "+(q.cpVariants.length-3)+" more":"")+". A CP firm dropdown in the sheet would stop this.");
  var body=(iss.length?'<ul class="fxi">'+iss.map(function(t){return"<li>"+t+"</li>"}).join("")+'</ul>':"")+
    (den.src?'<div class="fxgrid"><div><h3 class="lh">How complete the sheet is <span>fresh walk-ins, '+esc(P.label)+'</span></h3>'+bars+'</div><div><h3 class="lh">'+fmt(list.length)+' rows to fix <span>'+(mgr?"by closing manager: "+mgr:"")+'</span></h3>'+(list.length?'<table><thead><tr><th>Form No</th><th>Customer</th><th>Visit</th><th>Closing</th><th>What is missing</th></tr></thead><tbody>'+rows+'</tbody></table>'+(list.length>SHOW?'<button class="reset fxmore" data-ui="fixall" data-uv="1">Show all '+fmt(list.length)+' rows</button>':""):'<div class="okmsg">Every fresh walk-in in this period has its key fields filled.</div>')+'</div></div>':empty("No fresh walk-ins in this period"));
  return card("sFix","Data to fix",list.length?fmt(list.length)+" rows":"","",body,"auto");
}
// column heading check: a moved column makes every number wrong, so say it loudly
function hdrWarn(){var h=DATA&&DATA.Q&&DATA.Q.headers,bk=DATA&&DATA.Q&&DATA.Q.bk;
  if(bk&&bk.headers&&bk.headers.bad.length)return'<section class="card hwarn" role="alert"><b>Booking details’ columns look moved.</b> '+bk.headers.bad.slice(0,6).map(function(b){return"column "+b.col+" should be “"+esc(b.want)+"” but says “"+esc(b.got||"(blank)")+"”"}).join("; ")+'.</section>';
  if(!h||!h.bad||!h.bad.length)return"";
  return'<section class="card hwarn" role="alert"><b>The Walk-in sheet’s columns look moved.</b> Numbers may be wrong until this is fixed: '+h.bad.slice(0,6).map(function(b){return"column "+b.col+" should be “"+esc(b.want)+"” but says “"+esc(b.got||"(blank)")+"”"}).join("; ")+(h.bad.length>6?" and "+(h.bad.length-6)+" more":"")+'.</section>'}
function invCard(proj,id){
  var G=invBy(proj,"type"),ks=Object.keys(G).sort(function(a,b){return G[b].tot-G[a].tot}),t=inv(proj);
  if(!ks.length)return card(id,"Inventory by configuration","",'',empty("This project is not in the Inventory Status tab"));
  var rows=ks.map(function(k){var g=G[k];return'<tr><td>'+esc(k)+'</td><td class="bar"><div class="stk" title="Sold '+g.Sold+' · On hold '+g["On hold"]+' · Unsold '+g.Unsold+'"><i class="c-sold" style="width:'+g.Sold/g.tot*100+'%"></i><i class="c-hold" style="width:'+g["On hold"]/g.tot*100+'%"></i><i class="c-uns" style="width:'+g.Unsold/g.tot*100+'%"></i></div></td><td>'+fmt(g.Unsold)+'</td><td>'+fp(pct(g.Unsold,t.Unsold),0)+'</td><td>'+fmt(g.tot)+'</td></tr>'}).join("");
  return card(id,"Inventory by configuration","as of now",'','<div class="lg"><span><i class="c-sold"></i>Sold</span><span><i class="c-hold"></i>On hold</span><span><i class="c-uns"></i>Unsold</span></div><table><thead><tr><th>Type</th><th></th><th>Unsold</th><th>Share of unsold</th><th>Units</th></tr></thead><tbody>'+rows+'</tbody><tfoot><tr><td>Total</td><td></td><td>'+fmt(t.Unsold)+'</td><td>100%</td><td>'+fmt(t.tot)+'</td></tr></tfoot></table>');
}

/* ---------- focus ---------- */
var FDIMS=[["proj","Project"],["cm","Closing mgr"],["sm","Sourcing mgr"],["chan","Direct / Indirect"]];
function renderFocus(P,S,PS,TG,ser,weekly,serM){
  var m=M(focus),el=$("focus"),o=tileData(focus,P,S,PS,TG,serM||ser),c=METRICS.indexOf(m);
  var colors=["#E8432E","#4A4244","#9E1B22","#E07A64","#7A3034","#C2412F","#8C8183","#B9802F","#4A4244","#7A3034","#9C6A24","#3A3536"];
  var stTxt=o.a?(o.a.pc>=100?"Target achieved":o.a.st==="good"?"On pace for target":o.a.st==="warn"?"Slightly behind pace":"Behind pace"):(o.st==="good"?"Better than "+(PS?PS.P.label:"before"):o.st==="bad"?"Worse than "+(PS?PS.P.label:"before"):"");
  var ans='<section class="card fa" style="--fc:'+colors[c]+'"><div><div class="fa-label">'+esc(m.label)+' · '+esc(P.label)+'</div><div class="fa-num">'+o.big+(o.unit?'<small>'+esc(o.unit)+'</small>':"")+'</div>'+(stTxt?'<div class="fa-state">'+si(o.st)+esc(stTxt)+'</div>':"")+'<div class="fa-line">'+esc(o.sub)+(o.sub2&&o.sub2!==o.sub?'<br>'+esc(o.sub2):"")+(o.dt&&o.sub2!==o.dt?'<br>'+esc(o.dt):"")+'</div><div class="fa-def"><b>'+esc(m.fx)+'</b><br>'+esc(m.def)+'</div></div><button class="reset fa-x" data-unfocus>Close focus</button></section>';
  var mid,right;
  if(m.id==="nr"&&!m.ph){el.innerHTML=ans+(pOne(F.proj)?nrTrendCard(P):nrProjCard(P))+nrMixCard(P);return}
  if(m.inv){
    var G=invBy(F.proj,"proj"),ks=Object.keys(G).sort(function(a,b){return G[b].Unsold-G[a].Unsold});
    mid=card("fMid","Unsold by project","as of now","",'<div class="lg"><span><i class="c-sold"></i>Sold</span><span><i class="c-hold"></i>On hold</span><span><i class="c-uns"></i>Unsold</span></div><table><thead><tr><th>Project</th><th></th><th>Unsold</th><th>Units</th></tr></thead><tbody>'+ks.map(function(k){var g=G[k];return drow("proj",k,'<td>'+esc(k)+'</td><td class="bar"><div class="stk"><i class="c-sold" style="width:'+g.Sold/g.tot*100+'%"></i><i class="c-hold" style="width:'+g["On hold"]/g.tot*100+'%"></i><i class="c-uns" style="width:'+g.Unsold/g.tot*100+'%"></i></div></td><td>'+fmt(g.Unsold)+'</td><td>'+fmt(g.tot)+'</td>',!!F.proj&&pHas(F.proj,k))}).join("")+'</tbody></table>');
    right=invCard(F.proj,"fRight");
    el.innerHTML=ans+mid+right;return;
  }
  // trend
  var items=ser.keys.map(function(k){var s=ser.B[k],v=m.v(s),t=null;if(m.tgt){if(weekly){var W=m.tgt==="book"?TG.bookW:TG.walkW;t=W?W[k-1]:null}else{var MM=m.tgt==="book"?TG.bookM:TG.walkM;t=MM[k]!=null?MM[k]:null}}var lb=weekly?"Wk "+k:ymLab(k);return{lab:lb,v:v,t:t,per:weekly?null:"m"+k,tip:lb+": "+m.f(v)+(m.unit?" "+m.unit:"")+(t!=null?" · target "+fmt(t):"")}});
  var grpF=weekly?null:groupSer(ser);
  if(grpF)items=grpF.list.map(function(gp){var v=m.v(gp.s),t=m.tgt?grpTarget(m.tgt==="book"?TG.bookM:TG.walkM,gp.ks):null;return{lab:gp.lab,v:v,t:t,per:null,tip:gp.full+": "+m.f(v)+(m.unit?" "+m.unit:"")+(t!=null?" · target "+fmt(t):"")}});
  mid=card("fMid",m.label+(weekly?" by week":grpF?" by "+grpF.unit:" by month"),m.tgt&&(m.tgt==="book"?TG.book!=null:TG.walk!=null)?"▬ target":"","",'<div class="plot" style="position:absolute;inset:0"></div>',"chart");
  // breakdown
  // breakdown respects the filters: a filtered dimension shows only the picked value (with an "All" switch to compare)
  var DK={proj:"proj",cm:"cm",sm:"sm",chan:"src"},isF=function(d){return!!F[DK[d]]};
  var dim=ui.fdim;if(isF(dim)&&!ui.fdimPicked){var alt=FDIMS.map(function(x){return x[0]}).filter(function(d){return!isF(d)})[0];if(alt)dim=alt}
  var keyFn=dim==="chan"?chOf:function(r){return r[dim]};
  var selV=F[DK[dim]],cmpAll=ui.fcmp==="all",single=!!selV&&!cmpAll;
  var FF=Object.assign({},F);if(!single){if(dim==="chan")FF.src="";else FF[dim]=""}
  var G2=stats(FF,P,keyFn).G,ks2=Object.keys(G2).filter(function(k){var s=G2[k];return(s.fresh+s.gross+s.cx+s.rev)>0&&m.v(s)!=null&&(single||!m.min||(m.id==="conv"?s.fresh>=m.min:s.tat.length>=m.min))});
  ks2.sort(function(a,b){var x=m.v(G2[a]),y=m.v(G2[b]);return m.up>0?x-y:y-x});
  if(selV&&cmpAll&&ks2.indexOf(selV)>0){ks2.splice(ks2.indexOf(selV),1);ks2.unshift(selV)}
  var mx=0;ks2.forEach(function(k){mx=Math.max(mx,m.v(G2[k])||0)});
  var f=dim==="chan"?"src":dim;
  var ctx=[F.proj?pName(F.proj):"",F.cm?F.cm:"",F.sm?F.sm:"",F.src?(F.src==="Indirect"?"Indirect (CP)":F.src):""].filter(Boolean).join(" · ");
  var tg=togs("fdim",FDIMS,dim)+(selV?togs("fcmp",[["one",esc(lab(selV))+" only"],["all","All"]],cmpAll?"all":"one"):"");
  right=card("fRight","Worst first",esc(ctx),tg,ks2.length?'<table><tbody>'+ks2.map(function(k){var v=m.v(G2[k]);return drow(f,k,'<td title="'+esc(lab(k))+'">'+esc(lab(k))+'</td><td class="bar">'+hbar(v,mx,m.up>0?"":"alt")+'</td><td><b>'+m.f(v)+'</b></td>',F[f]===k)}).join("")+'</tbody></table>'+(single?'<div class="note">Showing '+esc(lab(selV))+' only. Tap “All” to compare, or pick another breakdown.</div>':m.min?'<div class="note">Rows with fewer than '+m.min+(m.id==="conv"?" fresh walk-ins":" bookings")+' are left out.</div>':""):empty("Nothing to compare in this period"));
  el.innerHTML=ans+mid+right;
  colChart(el.querySelector("#fMid .plot"),items,{fmt:function(v){return m.f(v)},aria:m.label+" trend",alt:m.up<0});
}

/* ---------- command centre ---------- */
function dl(d){var a=ymd(d);return a[2]+" "+MN[a[1]]}
function dr(a,b){return a===b?dl(a):dl(a)+" – "+dl(b)}
function n1(v){return v<10?String(Math.round(v*10)/10):fmt(v)}
function isProj(p){return!!p&&!/^all$/i.test(p)}
function topOf(o){var k=Object.keys(o).sort(function(a,b){return o[b]-o[a]})[0];return k?{k:k,n:o[k]}:null}
// one pass over the walk-in rows (current Project / Manager / Source filters, Period ignored) into daily counts
function cmdData(){
  var T=today(),Y=T-1,S=T-220,L=221;
  function z(){var a=new Array(L);for(var i=0;i<L;i++)a[i]=0;return a}
  function mk(){return{f:z(),r:z(),b:z(),c:z()}}
  var cpProj={},lastV=0,O=mk(),PJ={},lastBk={},lostO={},lostP={},cpOld={},cpNew={},cpBk={},cpLast={},w30=Y-29,cpA=Y-74,cpB=Y-30;
  ROWS.forEach(function(r){
    if(!pass(r,F))return;
    if(r.vday>lastV&&r.vday<=T)lastV=r.vday;
    var p=isProj(r.proj)?r.proj:null,P=p?(PJ[p]||(PJ[p]=mk())):null;
    function add(k,d){if(d>=S&&d<=T){O[k][d-S]++;if(P)P[k][d-S]++}}
    if(r.vday>0){if(r.kind===0)add("f",r.vday);else if(r.uniq)add("r",r.vday)}
    if(r.bk&&r.bday>0){add("b",r.bday);if(p&&r.bday<=Y&&!(lastBk[p]>=r.bday))lastBk[p]=r.bday}
    if(r.cx&&r.cday>0){add("c",r.cday);if(r.cday>=w30&&r.cday<=Y&&r.lost){lostO[r.lost]=(lostO[r.lost]||0)+1;if(p){var lp=lostP[p]||(lostP[p]={});lp[r.lost]=(lp[r.lost]||0)+1}}}
    if(r.cp&&isCP(r.src)){
      if(r.kind<2&&r.vday>0){if(r.vday>=cpA&&r.vday<=cpB){cpOld[r.cp]=(cpOld[r.cp]||0)+1;var cpp=cpProj[r.cp]||(cpProj[r.cp]={}),pn=p||"No project";cpp[pn]=(cpp[pn]||0)+1}else if(r.vday>cpB&&r.vday<=Y)cpNew[r.cp]=(cpNew[r.cp]||0)+1;if(r.vday<=Y&&!(cpLast[r.cp]>=r.vday))cpLast[r.cp]=r.vday}
      if(r.bk&&r.bday>=cpA&&r.bday<=cpB)cpBk[r.cp]=(cpBk[r.cp]||0)+1;
    }
  });
  function sum(a,from,to){var s=0;for(var d=from;d<=to;d++){var i=d-S;if(i>=0&&i<L)s+=a[i]}return s}
  return{cpProj:cpProj,lastV:lastV,T:T,Y:Y,O:O,PJ:PJ,lastBk:lastBk,lostO:lostO,lostP:lostP,cpOld:cpOld,cpNew:cpNew,cpBk:cpBk,cpLast:cpLast,sum:sum,w30:w30,cpA:cpA,cpB:cpB};
}
var CHECKS=[
  ["stall","Project stalled","M4 21V6l8-3 8 3v15M9 21v-4h6v4M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01"],
  ["conv","Conversion dropped","M3 4h18l-7 8v6l-4 2v-8z"],
  ["cx","Cancellation spike","M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"],
  ["walk","Walk-ins slowing","M22 17l-8.5-8.5-5 5L2 7M16 17h6v-6"],
  ["cp","CP firms quiet","M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"]];
function chk(t){return CHECKS.filter(function(x){return x[0]===t})[0]}
function ico(t){return'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+chk(t)[2]+'"/></svg>'}
var SRC_WALK="Fresh walk-in = column AW (Customer Fresh/Revisit) is “Fresh”, dated by column C (Date of Visit). Project = column B.",
    SRC_BOOK="Booking = column AT (Booking Date) has a date, or AR (Booking Done) = Y, or AU (Booking Cancellation) = Yes; dated by column AT.",
    SRC_CX="Cancellation = column AU (Booking Cancellation) is “Yes”, dated by column AV (Cancellation Date; booking date if empty). Lost reason = column AP.";
function cmdFlags(D){
  var Y=D.Y,T=D.T,w30=D.w30,bA=Y-209,bB=Y-30,sum=D.sum,fl=[];
  var W30=dr(w30,Y),B180=dr(bA,bB),W7=dr(Y-6,Y),B28=dr(Y-34,Y-7);
  function cxFlag(name,A,lost,open){
    var c30=sum(A.c,w30,Y),c180=sum(A.c,bA,bB),norm=c180/6;
    if(c30>=3&&c30>1.5*norm){var tl=topOf(lost||{});
      fl.push({t:"cx",lvl:2,score:norm?c30/norm:c30,title:name+" cancellations up: "+c30+" in 30 days vs usual "+n1(norm)+"/month",ev:tl?"Top lost reason: “"+tl.k+"” ("+tl.n+" of "+c30+")":"No lost reason entered in column AP",
        bars:[["Last 30 days",c30,fmt(c30)],["Usual per month",norm,n1(norm)]],
        steps:[["Cancellations, last 30 days ("+W30+")",fmt(c30)],["Cancellations, previous 6 months ("+B180+")",fmt(c180)],["Usual per month = "+fmt(c180)+" ÷ 6",n1(norm)],["Rule: more than 1.5 × usual ("+n1(1.5*norm)+") and at least 3",c30+" → flagged"]].concat(tl?[["Most common lost reason (column AP) among these cancellations","“"+tl.k+"” — "+tl.n]]:[]),
        src:SRC_CX+(name==="Overall"?"":" Project = column B."),open:Object.assign({k:"cx"},open)})}
  }
  function walkFlag(name,A,open,drops){
    var f7=sum(A.f,Y-6,Y),f28=sum(A.f,Y-34,Y-7),base=f28/4;
    if(base>=10&&f7<.7*base){var dn=Math.round((1-f7/base)*100);
      fl.push({t:"walk",lvl:1,score:1-f7/base,title:name+" walk-ins down "+dn+"% this week: "+f7+" vs usual "+n1(base)+"/week",ev:drops&&drops.length?"Biggest drops: "+drops.map(function(x){return x.p+" "+Math.round(x.d)}).join(", "):"Last 7 days ("+W7+") vs the 4 weeks before",
        bars:[["Last 7 days",f7,fmt(f7)],["Usual per week",base,n1(base)]],
        steps:[["Fresh walk-ins, last 7 days ("+W7+")",fmt(f7)],["Fresh walk-ins, 4 weeks before ("+B28+")",fmt(f28)],["Usual per week = "+fmt(f28)+" ÷ 4",n1(base)],["Rule: below 70% of usual ("+n1(.7*base)+"); only checked when usual is 10+ a week",f7+" → flagged"]].concat(drops&&drops.length?[["Projects with the biggest drop (last 7 days minus their usual week)",drops.map(function(x){return x.p+" "+Math.round(x.d)}).join(", ")]]:[]),
        src:SRC_WALK,open:Object.assign({k:"fresh"},open)})}
  }
  var projs=Object.keys(D.PJ).sort(),el={stall:[],conv:[]};
  projs.forEach(function(p){
    var A=D.PJ[p],f30=sum(A.f,w30,Y),b30=sum(A.b,w30,Y),f180=sum(A.f,bA,bB),b180=sum(A.b,bA,bB),op={p:p};
    var n30=b30-sum(A.c,w30,Y),n180=b180-sum(A.c,bA,bB); // net bookings, for conversion
    if(f30>=15)el.stall.push({p:p,f:f30,b:b30});
    if(!(f30>=15&&b30===0)&&f30>=20&&b180>=5&&f180)el.conv.push({p:p,c:n30/f30*100,n:n180/f180*100});
    if(f30>=15&&b30===0){var lb=D.lastBk[p];
      fl.push({t:"stall",lvl:2,score:f30,title:p+": "+f30+" walk-ins, 0 bookings in 30 days",ev:lb?"Last booking: "+dl(lb)+" ("+(T-lb)+" days ago)":"No booking on record",
        bars:[["Fresh walk-ins",f30,fmt(f30)],["Bookings",0,"0"]],
        steps:[["Fresh walk-ins, last 30 days ("+W30+")",fmt(f30)],["Bookings, last 30 days ("+W30+")","0"],["Last booking for "+p,lb?dl(lb)+" ("+(T-lb)+" days ago)":"none on record"],["Rule: 15 or more walk-ins and 0 bookings","flagged"]],
        src:SRC_WALK+" "+SRC_BOOK,open:{p:p,k:"fresh"}})}
    else if(f30>=20&&b180>=5&&f180){var c30=n30/f30*100,c180=n180/f180*100;
      if(c180>0&&c30<c180/2)fl.push({t:"conv",lvl:1,score:1-c30/c180,title:p+" conversion down: "+fp(c30)+" vs normal "+fp(c180),ev:n30+" net bookings from "+f30+" walk-ins in the last 30 days",
        bars:[["Last 30 days",Math.max(0,c30),fp(c30)],["Previous 6 months",c180,fp(c180)]],
        steps:[["Last 30 days ("+W30+"): "+n30+" net bookings ÷ "+f30+" fresh walk-ins",fp(c30)],["Previous 6 months ("+B180+"): "+n180+" net bookings ÷ "+fmt(f180)+" fresh walk-ins",fp(c180)],["Half of normal",fp(c180/2)],["Rule: recent below half of normal; only with 20+ walk-ins and 5+ earlier bookings",fp(c30)+" → flagged"]],
        src:SRC_WALK+" "+SRC_BOOK,open:{p:p,k:"conv"}})}
    cxFlag(p,A,D.lostP[p],op);
    walkFlag(p,A,op);
  });
  if(!F.proj){
    cxFlag("Overall",D.O,D.lostO,{});
    var drops=projs.map(function(p){var A=D.PJ[p];return{p:p,d:sum(A.f,Y-6,Y)-sum(A.f,Y-34,Y-7)/4}}).filter(function(x){return x.d<=-1}).sort(function(a,b){return a.d-b.d}).slice(0,3);
    walkFlag("Overall",D.O,{},drops);
  }
  var quiet=Object.keys(D.cpOld).filter(function(c){return D.cpOld[c]>=3&&!D.cpNew[c]}).sort(function(a,b){return D.cpOld[b]-D.cpOld[a]||a.localeCompare(b)});
  if(quiet.length){
    var bk=function(c){var b=D.cpBk[c]||0;return b+" booking"+(b===1?"":"s")};
    // which project each quiet firm's earlier walk-ins were for
    var pj=function(c){var o=D.cpProj[c]||{};return Object.keys(o).sort(function(a,b){return o[b]-o[a]||a.localeCompare(b)})},
        pjTxt=function(c){var o=D.cpProj[c]||{};return pj(c).map(function(k){return k+(pj(c).length>1?" ("+o[k]+")":"")}).join(", ")},
        byP={};quiet.forEach(function(c){var m=pj(c)[0]||"No project";byP[m]=(byP[m]||0)+1});
    var grp=Object.keys(byP).sort(function(a,b){return(a==="No project")-(b==="No project")||byP[b]-byP[a]}).map(function(k){return k+" "+byP[k]}).join(" · ");
    fl.push({t:"cp",lvl:1,score:quiet.length/10,title:quiet.length+" CP firm"+(quiet.length>1?"s":"")+" gone quiet: "+grp,
      ev:quiet.slice(0,3).map(function(c){return c+" ("+D.cpOld[c]+" walk-ins earlier, "+bk(c)+")"}).join(" · ")+(quiet.length>3?" + "+(quiet.length-3)+" more":""),
      bars:quiet.slice(0,5).map(function(c){return[c,D.cpOld[c],D.cpOld[c]+" walk-ins"]}),
      steps:[["Earlier window (45 days)",dr(D.cpA,D.cpB)],["Quiet window (last 30 days)",W30],["Rule: 3+ walk-ins (fresh or revisit) in the earlier window and none in the quiet window",quiet.length+" firms → flagged"],["By project (where most of each firm’s earlier walk-ins went, column B)",grp]],
      table:'<div class="ftw"><table class="ftab"><thead><tr><th>CP firm (column AA)</th><th>Project</th><th>Walk-ins '+dr(D.cpA,D.cpB)+'</th><th>Bookings then</th><th>Last visit</th></tr></thead><tbody>'+quiet.map(function(c){return'<tr><td>'+esc(c)+'</td><td class="fproj">'+esc(pjTxt(c))+'</td><td>'+D.cpOld[c]+'</td><td>'+(D.cpBk[c]||0)+'</td><td>'+dl(D.cpLast[c])+'</td></tr>'}).join("")+'</tbody></table></div>',
      src:"CP walk-in = column Z (Source) contains “Channel”; firm = column AA (Channel Partner Company); visit dated by column C. Fresh and revisits both count (column AW). Spellings that differ only in case or spaces are merged.",open:{s:"Indirect",k:"cpf"}});
  }
  fl.sort(function(a,b){return b.lvl-a.lvl||b.score-a.score});
  // what each check looked at, shown when it passed or could not run
  var sm={},pl=function(n,w){return n+" "+w+(n===1?"":"s")},who=F.proj?pName(F.proj):"Overall";
  var st=el.stall.slice().sort(function(a,b){return a.b-b.b||b.f-a.f});
  sm.stall=st.length?{text:pl(st.length,"project")+" had 15+ fresh walk-ins in the last 30 days ("+W30+"), and "+(st.length===1?"it":"each")+" also had at least one booking.",list:st.map(function(x){return x.p+": "+x.f+" walk-ins, "+pl(x.b,"booking")})}
    :{skip:1,text:"No project had 15 or more fresh walk-ins in the last 30 days ("+W30+"), so there was nothing to test."};
  sm.conv=el.conv.length?{text:pl(el.conv.length,"project")+" had enough data (20+ fresh walk-ins in the last 30 days and 5+ bookings in the 6 months before). None fell below half of its normal conversion.",list:el.conv.map(function(x){return x.p+": "+fp(x.c)+" now vs normal "+fp(x.n)+" (alert below "+fp(x.n/2)+")"})}
    :{skip:1,text:"No project had 20+ fresh walk-ins in the last 30 days ("+W30+") together with 5+ bookings in the 6 months before ("+B180+"), so conversion could not be compared fairly."};
  var oc30=sum(D.O.c,w30,Y),oc180=sum(D.O.c,bA,bB),on=oc180/6;
  var obk=sum(D.O.b,bA,Y);
  sm.cx=!obk&&!oc30&&!oc180?{skip:1,text:who+" had no bookings in "+dr(bA,Y)+", so there was nothing that could be cancelled."}:{text:who+": "+pl(oc30,"cancellation")+" in the last 30 days ("+W30+") vs usual "+n1(on)+"/month ("+fmt(oc180)+" in "+B180+" ÷ 6). An alert needs more than "+n1(1.5*on)+" and at least 3."+(F.proj?"":" Each project was also checked the same way; none spiked.")};
  var of7=sum(D.O.f,Y-6,Y),of28=sum(D.O.f,Y-34,Y-7),ob=of28/4;
  sm.walk=ob>=10?{text:who+": "+pl(of7,"fresh walk-in")+" in the last 7 days ("+W7+") vs usual "+n1(ob)+"/week ("+fmt(of28)+" in "+B28+" ÷ 4), which is "+Math.round(of7/ob*100)+"% of usual. An alert needs below 70% ("+n1(.7*ob)+")."+(F.proj?"":" Projects with 10+ walk-ins a week were also checked; none dropped below 70%.")}
    :{skip:1,text:"Usual fresh walk-ins for these filters are only "+n1(ob)+" a week ("+fmt(of28)+" in "+B28+" ÷ 4). The check needs a usual of 10+ a week, so small swings are not flagged."};
  var act=Object.keys(D.cpOld).filter(function(c){return D.cpOld[c]>=3});
  sm.cp=act.length?{text:pl(act.length,"CP firm")+" had 3+ walk-ins in "+dr(D.cpA,D.cpB)+", and all of them brought at least one walk-in in the last 30 days ("+W30+")."}
    :{skip:1,text:"No CP firm had 3 or more walk-ins in "+dr(D.cpA,D.cpB)+", so there was no active firm to watch."};
  fl.sm=sm;
  return fl;
}
/* data checks: whole sheet, filters ignored */
var COLN={visit:"Date of Visit (column C)",booking:"Booking Date (column AT)",cancellation:"Cancellation Date (column AV)"};
function rowList(a,n){return a&&a.length?"Rows "+a.join(", ")+(n>a.length?" … and "+(n-a.length)+" more":""):""}
function dataChecks(){
  var Q=DATA.Q||{},T=today(),Y=T-1,out=[];
  // 0. the picked project itself (only the Project filter applies here)
  if(pOne(F.proj)){var lp=0,p30=0;ROWS.forEach(function(r){if(r.proj!==F.proj)return;if(r.vday>lp&&r.vday<=T)lp=r.vday;if(r.kind===0&&r.vday>=Y-29&&r.vday<=Y)p30++});
    var pl=lp?T-lp:-1,nm=lab(F.proj),ago=pl===0?"today":pl===1?"yesterday":pl+" days ago";
    if(!isProj(F.proj))out.push({pin:1,lvl:1,title:"“"+nm+"” is not a single project",text:p30+" fresh walk-ins in "+dr(Y-29,Y)+" are tagged “"+nm+"” in column B. They cannot be checked per project, so most checks show “Not checked”.",fix:"Tag each walk-in with its actual project in column B."});else
    out.push({pin:1,lvl:pl<0||pl>2?1:0,title:nm+": "+(lp?"last walk-in "+dl(lp)+" ("+ago+")":"no walk-ins recorded"),
      text:p30+" fresh walk-in"+(p30===1?"":"s")+" in "+dr(Y-29,Y)+"."+(p30<15?" That is below the 15 a month the project checks need, so they show “Not checked”.":""),
      fix:pl<0?"Check that walk-ins for "+nm+" have Project (column B) filled in.":pl>2?"Enter "+nm+"’s walk-ins since "+dl(lp)+", with Project (column B) filled in.":""})}
  // booking tracker: is it connected, and how many bookings match a walk-in by Form No
  if(DATA.bookingError)out.push({lvl:2,title:"Booking details could not be read",text:DATA.bookingError+". Bookings are taken from the Walk-in sheet until this is fixed.",fix:"Check the Booking details tab in All Data.xlsx: its heading row (within the first 10 rows) must include “Overall Status”."});
  else if(HAS_BK&&Q.bk){var B=Q.bk,nb=B.booked+B.cancelled,un=ROWS.filter(function(r){return r.bkRow&&!r.linked}),st=Object.keys(B.statuses).map(function(k){return k+" "+fmt(B.statuses[k])}).join(" · ");
    out.push({lvl:un.length?1:0,title:fmt(nb-un.length)+" of "+fmt(nb)+" bookings matched a walk-in",text:"Bookings come from Booking details. A booking is matched by exact Form No (column B = Walk-in column A). The first visit is that customer’s earliest fresh walk-in on or before the booking; where a Form No was reused, the customer name tells the customers apart. The walk-in gives only the first visit date, name and profile. Differences are listed on the Site Head tab under Booking details vs Walk-in. Direct or Indirect comes from Booking details column Q (Source Type); column R names the CP firm.",
      lines:[st].concat(un.filter(function(r){return!r.id}).length?[fmt(un.filter(function(r){return!r.id}).length)+" bookings have no Form No (column B)"]:[]).concat(un.filter(function(r){return r.id}).length?["Form No with no walk-in on or before the booking: "+un.filter(function(r){return r.id}).slice(0,12).map(function(r){return r.id}).join(", ")+(un.filter(function(r){return r.id}).length>12?" and "+(un.filter(function(r){return r.id}).length-12)+" more":"")]:[]).concat(B.noStatus?[fmt(B.noStatus)+" rows have a Booking Date but no Overall Status, so they are not counted"]:[]).concat(RATE_OUT.length?[fmt(RATE_OUT.length)+" bookings have a ₹/sq ft more than 40% away from their project’s usual rate, so they are left out of realisation (sales value keeps them). Check agreement value (AH) and carpet area (AD): "+RATE_OUT.slice(0,8).map(function(r){return(r.id||"no Form No")+" ₹"+fmt(Math.round(r.av/r.carpet))}).join(", ")+(RATE_OUT.length>8?" and "+(RATE_OUT.length-8)+" more":"")]:[]).concat(B.cxBeforeBk&&B.cxBeforeBk.length?[fmt(B.cxBeforeBk.length)+" cancellations are dated before their booking, so they are counted in the booking month: "+B.cxBeforeBk.slice(0,8).map(function(x){return(x.id||"no Form No")+" (row "+x.row+")"}).join(", ")]:[]).concat(B.noValue?[fmt(B.noValue)+" bookings have no agreement value (AH)"]:[]).concat(B.noCarpet?[fmt(B.noCarpet)+" bookings have no carpet area (AD)"]:[]),
      fix:un.length?"Correct the Form No on these bookings so it matches the Walk-in sheet.":""})}
  // 1. dates after today
  var fu=Q.future;
  // with Booking details connected, the Walk-in booking and cancellation columns are not used, so only visit dates are checked
  var DK3=HAS_BK?["visit"]:["visit","booking","cancellation"];
  if(fu){var tot=0;DK3.forEach(function(k){tot+=fu[k].n});
    out.push(tot?{lvl:2,title:fmt(tot)+" date"+(tot>1?"s are":" is")+" after today",text:"Visits, bookings and cancellations cannot happen in the future, so these dates are wrong and are left out of today and this-week counts.",
      lines:DK3.filter(function(k){return fu[k].n}).map(function(k){return COLN[k]+": "+fmt(fu[k].n)+" · "+rowList(fu[k].rows,fu[k].n)}),fix:"Open these rows and correct the date, written as dd-mm-yyyy."}
      :{lvl:0,title:"No dates after today",text:"Every visit, booking and cancellation date is today or earlier."})}
  // 2. date format
  var ev=Q.dateEvidence;
  if(ev){var bad=[],okl=[],warn=[];
    DK3.forEach(function(k){var e=ev[k];if(!e)return;var dm=e.order==="dmy";
      if(e.dayFirst&&e.monthFirst){var minR=dm?e.monthFirstRows:e.dayFirstRows,minN=dm?e.monthFirst:e.dayFirst;
        bad.push(COLN[k]+": "+fmt(e.dayFirst)+" written day-first and "+fmt(e.monthFirst)+" month-first. Read as "+(dm?"day-month":"month-day")+", so the "+fmt(minN)+" "+(dm?"month-first":"day-first")+" ones, and any of the "+fmt(e.either)+" that could go either way, may be wrong. "+rowList(minR,minN))}
      else if(!e.dayFirst&&!e.monthFirst&&e.either)warn.push(COLN[k]+": "+fmt(e.either)+" dates like 05-06-2026 and none with a day above 12, so day and month cannot be told apart.");
      else if(e.dayFirst||e.monthFirst)okl.push(COLN[k]+": read as "+(dm?"day-month":"month-day")+" ("+fmt(dm?e.dayFirst:e.monthFirst)+" dates prove it, e.g. "+(dm?"20-10-2026":"10-20-2026")+").")});
    if(bad.length)out.push({lvl:2,title:"Mixed date formats",text:"Some dates are written day-first and others month-first in the same column.",lines:bad,fix:"Write every date the same way, dd-mm-yyyy (or with the month as a word, e.g. 8-Nov-2026)."});
    else if(warn.length)out.push({lvl:1,title:"Date order can't be confirmed",text:"",lines:warn,fix:"Enter at least some dates with a day above 12, or write the month as a word."});
    else out.push({lvl:0,title:"Date format consistent",text:okl.length?"":"Dates are stored as real date cells, so there is no day/month doubt.",lines:okl})}
  // 3. sheet up to date
  var lastV=0;ROWS.forEach(function(r){if(r.vday>lastV&&r.vday<=T)lastV=r.vday});
  var lag=lastV?T-lastV:-1;
  out.push(lag>2?{lvl:1,title:"Walk-in sheet looks behind",text:"The latest Date of Visit entered is "+dl(lastV)+", "+lag+" days ago. Until the sheet catches up, recent walk-ins look low, so “Walk-ins slowing” and Today & this week may be overstated.",fix:"Enter the missing walk-ins since "+dl(lastV)+"."}
    :{lvl:0,title:"Sheet is up to date",text:lastV?"Latest Date of Visit: "+dl(lastV)+".":"No visit dates found."});
  // 4. project missing
  var n30=0,miss=0;ROWS.forEach(function(r){if(r.kind===0&&r.vday>=Y-29&&r.vday<=Y){n30++;if(!isProj(r.proj))miss++}});
  var pm=n30?miss/n30*100:0;
  out.push(n30&&pm>20?{lvl:pm>50?2:1,title:"Project missing on "+fp(pm,0)+" of recent walk-ins",text:fmt(miss)+" of "+fmt(n30)+" fresh walk-ins in "+dr(Y-29,Y)+" have Project (column B) blank or “All”. They count in the overall totals, but the project checks (Project stalled, Conversion dropped) cannot use them.",fix:"Fill in column B for these walk-ins."}
    :{lvl:0,title:"Projects filled in",text:n30?fmt(n30-miss)+" of "+fmt(n30)+" fresh walk-ins in "+dr(Y-29,Y)+" have a project.":"No fresh walk-ins in the last 30 days."});
  // 5. sudden jumps
  var P={},O={a:0,b:0};ROWS.forEach(function(r){if(r.kind!==0)return;var a=r.vday>=Y-6&&r.vday<=Y,b=r.vday>=Y-34&&r.vday<=Y-7;if(!a&&!b)return;
    if(a)O.a++;else O.b++;if(isProj(r.proj)){var p=P[r.proj]||(P[r.proj]={a:0,b:0});if(a)p.a++;else p.b++}});
  var jumps=[];function jt(name,x){var base=x.b/4;if(x.a-base>=10&&x.a>=3*base)jumps.push(name+": "+x.a+" fresh walk-ins in the last 7 days vs usual "+n1(base)+"/week"+(base?" ("+n1(x.a/base)+"×)":""))}
  jt("Overall",O);Object.keys(P).sort().forEach(function(p){jt(p,P[p])});
  out.push(jumps.length?{lvl:1,title:"Sudden jump in walk-ins",text:"Last 7 days ("+dr(Y-6,Y)+") are at least 3× the usual week and 10+ above it. That can be a real surge, but it is often duplicate rows or wrong dates.",lines:jumps,fix:"Check these walk-ins for duplicates and date mistakes."}
    :{lvl:0,title:"No sudden jumps",text:"No project's walk-ins in the last 7 days jumped to 3× its usual week."});
  return out;
}
function dataHtml(dc){
  var nR=dc.filter(function(x){return x.lvl===2}).length,nA=dc.filter(function(x){return x.lvl===1}).length;
  var issues=dc.filter(function(x){return x.lvl||x.pin}).sort(function(a,b){return(b.pin||0)-(a.pin||0)||b.lvl-a.lvl}),oks=dc.filter(function(x){return!x.lvl&&!x.pin});
  function det(x){return(x.text?'<p>'+esc(x.text)+'</p>':"")+(x.lines&&x.lines.length?'<ul>'+x.lines.map(function(l){return'<li>'+esc(l)+'</li>'}).join("")+'</ul>':"")+(x.fix?'<p class="dfix"><b>Fix:</b> '+esc(x.fix)+'</p>':"")}
  var rows=issues.map(function(x){var cl=x.lvl===2?"bad":x.lvl===1?"warn":"ok";
    return'<details class="drow '+cl+(x.pin?" pin":"")+'"><summary><span class="pic">'+(x.lvl===2?"✕":x.lvl===1?"!":"✓")+'</span><b><span class="sr">'+(x.lvl===2?"Fix needed: ":x.lvl===1?"Check: ":"OK: ")+'</span>'+esc(x.title)+'</b><span class="fchev" aria-hidden="true">›</span></summary><div class="dbody">'+det(x)+'</div></details>'}).join("");
  if(oks.length)rows+='<details class="drow ok"><summary><span class="pic">✓</span><b>'+oks.length+' check'+(oks.length>1?"s":"")+' OK</b><span class="fchev" aria-hidden="true">›</span></summary><div class="dbody"><ul class="oklist">'+oks.map(function(x){return'<li><b>'+esc(x.title)+'</b>'+(x.text?' — '+esc(x.text):"")+(x.lines&&x.lines.length?' '+esc(x.lines.join(" ")):"")+'</li>'}).join("")+'</ul></div></details>';
  return'<section class="card cdata" id="ccData"><div class="chd"><h2>Data checks</h2>'+(nR?'<span class="cnt r">'+nR+' to fix</span>':"")+(nA?'<span class="cnt a">'+nA+' to check</span>':"")+(!nR&&!nA?'<span class="cnt g">all OK</span>':"")+'<span class="sub">tap to see details</span></div><div class="cbd"><div class="dlist">'+rows+'</div></div></section>';
}
function ccClock(){return new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata",weekday:"short",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"})}
function flagHtml(f){
  var o=f.open||{},red=f.lvl===2,mx=0;f.bars.forEach(function(b){mx=Math.max(mx,b[1])});
  var bars='<div class="cbars">'+f.bars.map(function(b,i){return'<div class="cb"><span class="cbl">'+esc(b[0])+'</span><span class="cbt"><i class="'+(i===0&&f.t!=="cp"?(red?"r":"a"):"")+'" style="width:'+(mx?Math.max(b[1]?2:0,b[1]/mx*100):0).toFixed(1)+'%"></i></span><b>'+esc(b[2])+'</b></div>'}).join("")+'</div>';
  return'<details class="flag '+(red?"r":"a")+'"><summary><span class="fic">'+ico(f.t)+'</span><span class="fmain"><span class="ft"><span class="sr">'+(red?"Red":"Amber")+' alert: </span>'+esc(f.title)+'</span></span><span class="fchev" aria-hidden="true">›</span></summary>'+
    '<div class="fbody"><p class="fev"><span class="ftag">'+(red?"Red":"Amber")+' · '+chk(f.t)[1]+'</span> '+esc(f.ev)+'</p>'+bars+'<h4>How it was worked out</h4><ol class="steps">'+f.steps.map(function(s){return'<li><span class="sl">'+esc(s[0])+'</span><span class="sv">'+esc(s[1])+'</span></li>'}).join("")+'</ol>'+(f.table||"")+
    '<p class="fsrc"><b>Fields used:</b> '+esc(f.src)+'</p><button class="reset fgo" data-cmdopen="'+esc(o.k||"")+'" data-p="'+esc(o.p||"")+'" data-s="'+esc(o.s||"")+'">Open in Management (last 30 days) →</button></div></details>';
}
/* ---------- command centre, Phase 1: month story → attention → projects ---------- */
var MNF=["January","February","March","April","May","June","July","August","September","October","November","December"];
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1)}
function pn(s){return String(s).toLowerCase().replace(/(^|[\s.\-'])([a-z])/g,function(m,a,b){return a+b.toUpperCase()})}
// month context: only completed days count (data up to yesterday), so half-entered "today" never skews pace
function m2Month(){var T=today(),ym=ymOf(T),ms=monStart(ym),me=monEnd(ym),days=me-ms+1,d=T-ms;return{T:T-1,today:T,ym:ym,ms:ms,me:me,days:days,d:d,pace:d/days,name:MNF[ym%100-1],sh:MN[ym%100-1]}}
// usual month shape: share of a month's bookings / walk-ins normally in by a given point of the month, from the last 3 complete months
function m2Curve(M,FF){
  var mons=[1,2,3].map(function(k){var ym=ymAdd(M.ym,-k),s=monStart(ym),e=monEnd(ym),L=e-s+1,b=[],w=[];for(var i=0;i<=L;i++){b[i]=0;w[i]=0}return{s:s,e:e,L:L,b:b,w:w,tb:0,tw:0}});
  ROWS.forEach(function(r){if(!pass(r,FF))return;mons.forEach(function(m){if(r.bk&&r.bday>=m.s&&r.bday<=m.e){m.b[r.bday-m.s+1]++;m.tb++}if(r.kind===0&&r.vday>=m.s&&r.vday<=m.e){m.w[r.vday-m.s+1]++;m.tw++}})});
  mons.forEach(function(m){for(var i=1;i<=m.L;i++){m.b[i]+=m.b[i-1];m.w[i]+=m.w[i-1]}});
  function mk(key,tot,min){var ms=mons.filter(function(m){return m[tot]>0}),sum=ms.reduce(function(a,m){return a+m[tot]},0);if(sum<min)return null;
    return function(f){if(f<=0)return 0;if(f>=1)return 1;var acc=0;ms.forEach(function(m){var x=f*m.L,i=Math.floor(x),v=m[key][i]+(i<m.L?(m[key][i+1]-m[key][i])*(x-i):0);acc+=v/m[tot]});return acc/ms.length}}
  return{b:mk("b","tb",10),w:mk("w","tw",30)};
}
function m2Pace(M){var lin=function(f){return f},f=M.d/M.days,cF=m2Curve(M,F),cA=F.proj?m2Curve(M,Object.assign({},F,{proj:""})):cF;
  M.sB=cF.b||cA.b||lin;M.sW=cF.w||cA.w||lin;M.patB=!!(cF.b||cA.b);M.patW=!!(cF.w||cA.w);M.coPat=F.proj&&(!cF.b||!cF.w)&&!!(cA.b||cA.w);
  M.pB=M.sB(f);M.pW=M.sW(f);M.cB=(cA.b||lin)(f);M.cW=(cA.w||lin)(f);
  // month-end forecast: actual ÷ usual share by now (straight line if the share is still tiny)
  M.fc=function(a,share){if(!M.d)return null;var v=share>=.05?a/share:a/M.d*M.days;return Math.max(0,Math.round(v))};
}
// targets for this month: bookings from Closing Targets (G), walk-ins from Sourcing Targets (I), rolled up by project (column C)
function m2Targets(M,proj){
  var p=proj!==undefined?proj:F.proj,b=0,w=0,bR=[],wR=[],bOk=!F.sm&&!F.src&&!F.cp,wOk=!F.cm&&!F.src&&!F.cp;
  if(bOk)CT.forEach(function(r){if(r.ym!==M.ym||(p&&!pHas(p,r.p))||(F.cm&&r.m!==F.cm))return;b+=r.t;bR.push(r)});
  if(wOk)ST.forEach(function(r){if(r.ym!==M.ym||(p&&!pHas(p,r.p))||(F.sm&&r.m!==F.sm))return;w+=r.t;wR.push(r)});
  return{b:b>0?b:null,w:w>0?w:null,bR:bR,wR:wR};
}
function m2St(a,t,p){if(!(t>0))return{k:"none"};var e=t*p;if(a>=t)return{k:"met",e:e};if(a>=e)return{k:"ok",e:e};if(a>=e*.8)return{k:"slight",e:e};return{k:"behind",e:e}}
function m2Uniq(a){return a.filter(function(x,i){return x&&a.indexOf(x)===i})}
function m2Owners(M,p){
  var cm=m2Uniq(CT.filter(function(r){return r.ym===M.ym&&r.p===p&&r.t>0}).map(function(r){return r.m})),sm=m2Uniq(ST.filter(function(r){return r.ym===M.ym&&r.p===p&&r.t>0}).map(function(r){return r.m}));
  if(!cm.length||!sm.length){var c={},s={};ROWS.forEach(function(r){if(r.proj!==p||r.vday<M.ms||r.vday>M.T)return;if(r.cm)c[r.cm]=(c[r.cm]||0)+1;if(r.sm)s[r.sm]=(s[r.sm]||0)+1});
    var top=function(o){var k=Object.keys(o).sort(function(a,b){return o[b]-o[a]})[0];return k?[k]:[]};if(!cm.length)cm=top(c);if(!sm.length)sm=top(s)}
  return{cm:cm,sm:sm};
}
// 30% or more of the month's fresh walk-ins have no project: walk-ins can't be judged project by project (same limit as the email)
function m2Untag(M){var u=DATA.UNT&&DATA.UNT[M.ym];if(u==null&&!DATA.UNT){var n=0,k=0;ROWS.forEach(function(r){if(r.kind!==0||r.vday<M.ms||r.vday>M.T)return;n++;if(!r.proj||r.proj==="All")k++});u=n?k/n*100:0}return u>=30?u:0}
function m2Walk(x,M){return M.nt&&!x.mute?'<div class="m2nt"><b>Not tagged</b><span>'+fmt(x.s.fresh)+' tagged'+(x.tg.w?' · target '+fmt(x.tg.w):' · no target')+'</span></div>':m2Bar(x.s.fresh,x.tg.w,M.cW)}
function m2Proj(M){
  var P={from:M.ms,to:M.T},FF=Object.assign({},F,{proj:""}),S=stats(FF,P,function(r){return isProj(r.proj)?r.proj:"__none"}).G,keys={};
  Object.keys(S).forEach(function(k){var s=S[k];if(s.fresh||s.gross||s.cx||s.rev)keys[k]=1});
  CT.concat(ST).forEach(function(r){if(r.ym===M.ym&&isProj(r.p)&&r.t>0)keys[r.p]=1});
  delete keys.__none;
  var list=Object.keys(keys).map(function(p){var s=S[p]||fin(blank()),tg=m2Targets(M,p),bs=m2St(s.net,tg.b,M.cB),ws=M.nt?{k:"none"}:m2St(s.fresh,tg.w,M.cW);
    var stall=!M.nt&&s.gross===0&&s.fresh>=8&&M.d>=7,st=stall?["Stalled","r"]:bs.k==="met"?[M.nt?"Bookings met":"Target met","g"]:bs.k==="behind"?["Behind","r"]:bs.k==="slight"?["Slightly behind","y"]:ws.k==="behind"?["Walk-ins low","y"]:bs.k==="ok"?["On pace","g"]:(ws.k==="ok"||ws.k==="met")?["Walk-ins on pace","g"]:[M.nt&&tg.w?"No booking target":"No target","m"];
    return{p:p,s:s,tg:tg,bs:bs,ws:ws,st:st,gb:tg.b?tg.b*M.cB-s.net:-1e9,gw:tg.w&&!M.nt?(tg.w*M.cW-s.fresh)/tg.w:-1e9}});
  list.sort(function(a,b){return(b.gb-a.gb)||(b.gw-a.gw)||(b.s.fresh-a.s.fresh)});
  var unt={b:0,w:0,n:0};
  if(!F.sm&&!F.src&&!F.cp)CT.forEach(function(r){if(r.ym===M.ym&&!isProj(r.p)&&r.t>0&&(!F.cm||r.m===F.cm)){unt.b+=r.t;unt.n++}});
  if(!F.cm&&!F.src&&!F.cp)ST.forEach(function(r){if(r.ym===M.ym&&!isProj(r.p)&&r.t>0&&(!F.sm||r.m===F.sm)){unt.w+=r.t;unt.n++}});
  return{list:list,none:S.__none||fin(blank()),unt:unt};
}
function m2Lost(p,M){var o={},n=0;ROWS.forEach(function(r){if(r.proj!==p||r.kind!==0||r.vday<M.ms||r.vday>M.T||r.bk||r.won)return;n++;if(r.lost)o[r.lost]=(o[r.lost]||0)+1});var t=topOf(o);return t?"“"+t.k+"” · "+t.n+" of "+n:"not entered (column AP)"}
function m2Recent(p,M){for(var i=0;i<ROWS.length;i++){var r=ROWS[i];if(r.proj===p&&r.kind===0&&r.vday>=M.ms-90&&r.vday<M.ms)return true}return false}
function m2LastBk(p,T){var lb=0;ROWS.forEach(function(r){if(r.proj===p&&r.bk&&r.bday<=T&&r.bday>lb)lb=r.bday});return lb}
function m2Box(lab,a,t,e,bad){var w=t?Math.min(100,a/t*100):0;return'<div class="m2box"><div class="m2bl">'+lab+'</div><div class="m2bv">'+fmt(a)+(t?' <small>/ '+fmt(t)+' · '+n1(e)+' expected by now</small>':' <small>no target</small>')+'</div>'+(t?'<div class="m2mb"><i class="'+bad+'" style="width:'+w.toFixed(1)+'%"></i><b style="left:'+(e/t*100).toFixed(1)+'%"></b></div>':"")+'</div>'}
function m2Drill(M,x,co){var s=x.s,tg=x.tg,lb=m2LastBk(x.p,M.T),cl=function(k){return k==="behind"?"r":k==="slight"?"y":"g"};
  var src=function(R,sheet){return R.length?sheet+", "+M.sh+" "+String(Math.floor(M.ym/100))+" · "+R.length+" row"+(R.length>1?"s":"")+" ("+m2Uniq(R.map(function(r){return pn(r.m)})).join(", ")+")":"no target row for "+x.p};
  return'<div class="m2dk">'+m2Box("Net bookings vs target",s.net,tg.b,x.bs.e,cl(x.bs.k))+(M.nt?'<div class="m2box"><div class="m2bl">Fresh walk-ins vs target</div><div class="m2bv">Not tagged <small>'+fmt(s.fresh)+' tagged'+(tg.w?' · target '+fmt(tg.w):"")+'</small></div></div>':m2Box("Fresh walk-ins vs target",s.fresh,tg.w,x.ws.e,cl(x.ws.k)))+'</div>'+
    '<ul class="m2facts"><li><span>Last booking</span><b>'+(lb?dl(lb)+(ymd(lb)[0]!==ymd(M.T)[0]?" "+ymd(lb)[0]:"")+" ("+(M.today-lb)+" days ago)":"none on record")+'</b></li>'+
    (HAS_BK?'<li><span>Sales value this month</span><b>'+(s.gross?fcr(s.sv)+(s.rpsf?" · ₹"+fmt(Math.round(s.rpsf))+" per sq ft":"")+" · "+sqf(s.sqft)+" sold"+(s.tatM!=null?" · booked "+Math.round(s.tatM)+" days after first visit (median)":""):"no bookings yet")+'</b></li>':"")+
    '<li><span>Conversion this month</span><b>'+(M.nt?"not judged: "+Math.round(M.nt)+"% of walk-ins have no project":s.conv==null?"no fresh walk-ins this month":fp(s.conv)+(F.proj||co==null?"":" vs company "+fp(co)))+'</b></li>'+
    '<li><span>Top reason walk-ins didn’t book (column AP)</span><b>'+esc(m2Lost(x.p,M))+'</b></li>'+
    '<li><span>Booking target from</span><b>'+esc(src(tg.bR,"Closing Targets"))+'</b></li>'+
    '<li><span>Walk-in target from</span><b>'+esc(src(tg.wR,"Sourcing Targets"))+'</b></li></ul>'+
    '<p class="m2how">Expected by now = target × the share you usually have after '+M.d+' of '+M.days+' days: '+Math.round(M.cB*100)+'% of bookings'+(M.patB?"":" (straight line, too little history)")+' and '+Math.round(M.cW*100)+'% of walk-ins'+(M.patW?"":" (straight line)")+', from the last 3 months. Counts run to the end of '+dl(M.T)+'. Net bookings = '+(HAS_BK?"bookings in Booking details (column AN) minus “Cancelled at Booking” (column V)":"bookings (Booking Date, column AT) minus cancellations (column AV)")+'.</p>'+
    '<button class="reset m2go" data-cmdopen="net" data-p="'+esc(x.p)+'" data-per="mtd">Open '+esc(x.p)+' in Management →</button>';
}
function m2Attention(M,PR,flags){var items=[];
  PR.list.forEach(function(x){if(F.proj&&!pHas(F.proj,x.p))return;var s=x.s,tg=x.tg,o=m2Owners(M,x.p);
    if(x.st[0]==="Stalled")items.push({lvl:2,score:100+s.fresh,title:x.p+" hasn’t had a booking this month, despite "+s.fresh+" walk-ins.",own:o,x:x});
    else if(tg.b&&(x.bs.k==="behind"||x.bs.k==="slight")){var g=Math.round(tg.b*M.cB-s.net);if(g>=1)items.push({lvl:x.bs.k==="behind"?2:1,score:(x.bs.k==="behind"?50:12)+g*10,title:x.p+" is "+g+" booking"+(g>1?"s":"")+" short of where it would usually be by now.",own:{cm:o.cm,sm:[]},x:x})}
    if(tg.w&&x.ws.k==="behind")items.push({lvl:1,score:20+(1-s.fresh/Math.max(.01,tg.w*M.cW))*10,title:x.p+" walk-ins are at "+Math.round(s.fresh/tg.w*100)+"% of target; by now you’d usually have "+Math.round(M.cW*100)+"%.",own:{cm:[],sm:o.sm},x:x});
  });
  // activity problems that need no target: more cancellations than bookings, walk-ins dried up
  PR.list.forEach(function(x){if(F.proj&&!pHas(F.proj,x.p))return;var s=x.s,o=m2Owners(M,x.p);
    if(s.net<0)items.push({lvl:2,score:70,title:x.p+" has more cancellations than bookings this month ("+s.cx+" cancelled, "+s.gross+" booked).",own:{cm:o.cm,sm:[]},x:x});
    if(!M.nt&&s.fresh===0&&M.d>=7&&(x.tg.w||m2Recent(x.p,M)))items.push({lvl:1,score:25,title:x.p+" hasn’t had a fresh walk-in this month.",own:{cm:[],sm:o.sm},x:x});
  });
  // pace can't be judged without a target
  if(pOne(F.proj)){var me=PR.list.filter(function(x){return x.p===F.proj})[0];
    if(!me||(!me.tg.b&&!me.tg.w))items.push({lvl:1,score:5,title:"No "+M.name+" target is set for "+F.proj+", so its pace can’t be judged.",note:"Add “"+F.proj+"” in column C (Project Name) of Closing Targets for the booking target and Sourcing Targets for the walk-in target, for "+M.name+" "+Math.floor(M.ym/100)+"."})}
  else{var noT=PR.list.filter(function(x){return(!F.proj||pHas(F.proj,x.p))&&!x.tg.b&&!x.tg.w&&(x.s.fresh||x.s.gross||x.s.cx)});
    if(noT.length)items.push({lvl:1,score:5,title:noT.length+" project"+(noT.length>1?"s":"")+" with activity this month "+(noT.length>1?"have":"has")+" no target, so "+(noT.length>1?"their":"its")+" pace can’t be judged.",
      note:"No target: "+noT.map(function(x){return x.p}).join(", ")+"."+(PR.unt.n?" "+PR.unt.n+" target row"+(PR.unt.n>1?"s":"")+" for "+M.name+" still say “All” in column C. Put the project name there and these projects get their targets.":" Add rows for them in Closing Targets and Sourcing Targets.")})}
  flags.forEach(function(f){if(f.t!=="cx"&&f.t!=="cp")return;var t=f.title;
    if(f.t==="cp")t=t.replace(/^(\d+) CP firms? gone quiet: (.*)$/,function(_,n,g){return n+" channel partner"+(n==="1"?"":"s")+" stopped sending walk-ins ("+g+")."});
    else t=t.replace(/^Overall /,"").replace(/^(.*?)\s*cancellations up: (\d+) in 30 days vs usual ([\d.]+)\/month$/,function(_,w,n,u){return(w?w+" cancellations":"Cancellations")+" are up: "+n+" in the last 30 days, against a usual "+u+" a month."});
    items.push({lvl:f.lvl,score:f.lvl===2?60:15,title:t,flag:f})});
  items.sort(function(a,b){return b.lvl-a.lvl||b.score-a.score});return items;
}
function m2Item(it,M,co){var red=it.lvl===2,own="";
  if(it.own){own=(it.own.cm||[]).map(function(n){return'<span class="m2who">Closing · '+esc(pn(n))+'</span>'}).join("")+(it.own.sm||[]).map(function(n){return'<span class="m2who">Sourcing · '+esc(pn(n))+'</span>'}).join("")}
  var body=it.note?'<p class="m2how m2note">'+esc(it.note)+'</p>':it.x?m2Drill(M,it.x,co):(function(){var h=flagHtml(it.flag),i=h.indexOf('<div class="fbody">');return i<0?"":h.slice(i+19,h.length-16)})();
  return'<details class="m2i '+(red?"r":"a")+'"><summary><span class="m2ic" aria-hidden="true">'+ic(red?"bang":"down")+'</span><span class="m2st"><span class="sr">'+(red?"Urgent: ":"Watch: ")+'</span><span class="m2t">'+esc(it.title)+'</span>'+(own?'<span class="m2o">'+own+'</span>':"")+'</span><span class="fchev" aria-hidden="true">›</span></summary><div class="m2d">'+body+'</div></details>';
}
function m2Bar(a,t,p){var k=m2St(a,t,p).k,c=k==="behind"?"r":k==="slight"?"y":k==="none"?"m":"g",w=t?Math.min(100,a/t*100):0;
  return'<div class="m2bar"><span class="m2bt '+c+'"><i style="width:'+w.toFixed(1)+'%"></i>'+(t?'<b style="left:'+(p*100).toFixed(1)+'%"></b>':"")+'</span><span class="m2bn"><b>'+fmt(a)+'</b>'+(t?' / '+fmt(t):' · no target')+'</span></div>'}
function m2Chart(M,tgt){
  var c=new Array(M.days+1);for(var i=0;i<=M.days;i++)c[i]=0;
  ROWS.forEach(function(r){if(!pass(r,F))return;if(r.bk&&r.bday>=M.ms&&r.bday<=M.T)c[r.bday-M.ms+1]++;if(r.cx&&r.cday>=M.ms&&r.cday<=M.T)c[r.cday-M.ms+1]--});
  var cum=[0];for(i=1;i<=M.d;i++)cum[i]=cum[i-1]+c[i];
  var now=cum[M.d],fc=M.fc(now,M.pB)||0,mx=Math.max(tgt||0,fc,Math.max.apply(null,cum),1),top=mx<=4?4:Math.ceil(mx*1.1/2)*2,W=320,H=140;
  // lines are drawn in a stretchable SVG; text and the "today" dot are HTML so they never get distorted
  var x=function(d){return W*d/M.days},y=function(v){return H-H*Math.max(0,v)/top},g="";
  [0,.5,1].forEach(function(f){g+='<line x1="0" x2="'+W+'" y1="'+y(top*f)+'" y2="'+y(top*f)+'" stroke="rgba(255,255,255,'+(f?.08:.25)+')" vector-effect="non-scaling-stroke"/>'});
  // target path follows the usual month shape (straight line when there is little history)
  var path=function(fn){var a=[];for(var k=0;k<=M.days;k++)a.push(x(k).toFixed(1)+","+y(fn(k)).toFixed(1));return a.join(" ")};
  if(tgt)g+='<polyline points="'+path(function(k){return tgt*M.sB(k/M.days)})+'" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-dasharray="2 4" vector-effect="non-scaling-stroke"/>';
  var pts=cum.map(function(v,i){return x(i).toFixed(1)+","+y(v).toFixed(1)}).join(" ");
  g+='<polygon points="'+x(0)+","+y(0)+" "+pts+" "+x(M.d).toFixed(1)+","+y(0)+'" fill="rgba(252,211,77,.14)"/>';
  g+='<polyline points="'+pts+'" fill="none" stroke="#FCD34D" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>';
  if(M.d<M.days){var s0=M.sB(M.d/M.days),fa=[];for(var k=M.d;k<=M.days;k++){var sk=M.sB(k/M.days),v=s0<1?now+(fc-now)*(sk-s0)/(1-s0):fc;fa.push(x(k).toFixed(1)+","+y(v).toFixed(1))}
    g+='<polyline points="'+fa.join(" ")+'" fill="none" stroke="#FCD34D" stroke-width="2.5" stroke-dasharray="5 4" opacity=".8" vector-effect="non-scaling-stroke"/>'}
  var px=function(d){return(d/M.days*100).toFixed(2)+"%"},py=function(v){return((1-Math.max(0,v)/top)*100).toFixed(2)+"%"};
  var lab='<span class="m2y" style="top:0">'+top+'</span><span class="m2y" style="top:50%">'+(top/2)+'</span><span class="m2y" style="top:100%">0</span>'+
    '<span class="m2dot" style="left:'+px(M.d)+';top:'+py(now)+'"></span><span class="m2lab now" style="left:'+px(M.d)+';top:'+py(now)+'">To '+dl(M.T)+': '+now+'</span>'+
    (M.d<M.days?'<span class="m2lab fc" style="left:100%;top:'+py(fc)+'">→ '+Math.round(fc)+'</span>':"");
  var xs=[[0,"1 "+M.sh,"s"],[10,"10",""],[20,"20",""],[M.days,M.days+" "+M.sh,"e"]].map(function(t){return'<span class="'+t[2]+'" style="left:'+px(t[0])+'">'+t[1]+'</span>'}).join("");
  return'<div class="m2plot"><svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="Net bookings added up day by day this month: '+now+' so far'+(tgt?", target "+tgt:"")+'">'+g+'</svg>'+lab+'</div><div class="m2x">'+xs+'</div>';
}
function cmdHtml(){
  var M=m2Month();m2Pace(M);M.nt=m2Untag(M);var D=cmdData(),fl=cmdFlags(D),dc=dataChecks();
  var S=stats(F,{from:M.ms,to:M.T}).tot,TG=m2Targets(M),PR=m2Proj(M);
  var lmY=ymAdd(M.ym,-1),L=stats(F,{from:monStart(lmY),to:Math.min(monStart(lmY)+M.d-1,monEnd(lmY))}).tot;
  var bs=m2St(S.net,TG.b,M.pB),pnt=M.nt&&F.proj&&isProj(F.proj),ws=pnt?{k:"none"}:m2St(S.fresh,TG.w,M.pW),gb=bs.e!=null?Math.round(bs.e-S.net):0,gw=ws.e!=null?Math.round(ws.e-S.fresh):0;
  var bOK=bs.k==="ok"||bs.k==="met",wOK=ws.k==="ok"||ws.k==="met",fcB=M.fc(S.net,M.pB),fcW=M.fc(S.fresh,M.pW);
  var who=F.proj?esc(pName(F.proj)):"we";
  // ① the headline sentence
  var bT=bs.k==="met"?"bookings have <em>hit the target</em>":bOK?"bookings are on pace":"bookings are <em>"+Math.max(1,gb)+" behind pace</em>";
  var wT=ws.k==="met"?"walk-ins have hit the target":wOK?"walk-ins are on pace":"walk-ins are <em>"+Math.max(1,gw)+" behind pace</em>";
  var head,mood;
  if(bs.k==="none"&&ws.k==="none"){head=fmt(S.net)+" net booking"+(S.net===1?"":"s")+" and "+fmt(S.fresh)+" fresh walk-ins so far this month.";mood="none"}
  else if(bs.k==="met"){head="Booking target achieved: <em>"+S.net+" of "+TG.b+"</em>, with "+(M.days-M.d)+" days still to go.";mood="good"}
  else if(bs.k==="none"){head=cap(wT)+".";mood=wOK?"good":"warn"}
  else if(ws.k==="none"){head=cap(bT)+".";mood=bOK?"good":bs.k==="slight"?"warn":"bad"}
  else if(bOK&&wOK){head="Bookings and walk-ins are both on pace"+(ws.k==="met"?", and walk-ins have already hit the target":"")+".";mood="good"}
  else if(wOK){head=(ws.k==="met"?"Walk-ins have already hit the target":"Walk-ins are on pace")+", but "+bT+".";mood=bs.k==="slight"?"warn":"bad"}
  else if(bOK){head=(bs.k==="met"?"Bookings have already hit the target":"Bookings are on pace")+", but "+wT+".";mood="warn"}
  else{head=cap(bT)+", and "+wT+".";mood=bs.k==="slight"?"warn":"bad"}
  var gapP=PR.list.filter(function(x){return x.gb>=1}).slice(0,2).map(function(x){return"<b>"+esc(x.p)+"</b>"});
  var sub=TG.b?"At this pace "+who+" close"+(pOne(F.proj)?"s ":" ")+M.name+" at <b>"+fcB+" of "+TG.b+"</b> bookings."+(!bOK&&!F.proj&&gapP.length?" "+gapP.join(" and ")+(gapP.length>1?" explain":" explains")+" most of the gap.":""):"No booking target is set for "+(F.proj?esc(pName(F.proj))+" in ":"")+M.name+" yet"+(F.proj?" (Closing Targets, column C).":".");
  var ctx=[F.proj?pName(F.proj):"",F.cm,F.sm,F.src?(F.src==="Indirect"?"Indirect (CP)":F.src):""].filter(Boolean).map(esc).join(" · ");
  // KPI cards
  function chip(st,g){if(!M.d&&st.k!=="none"&&st.k!=="met")return'<span class="m2chip none">Month just started</span>';return st.k==="met"?'<span class="m2chip ok">Target met</span>':st.k==="ok"?'<span class="m2chip ok">On pace</span>':st.k==="slight"?'<span class="m2chip warn">Slightly behind</span>':st.k==="behind"?'<span class="m2chip bad">'+Math.max(1,g)+' behind pace</span>':'<span class="m2chip none">No target set</span>'}
  // compare with the same days of last month, and say which days
  var lmDays=Math.min(M.d,monEnd(lmY)-monStart(lmY)+1),lmLab=lmDays<1?"":lmDays===1?"1 "+MN[lmY%100-1]:"1–"+lmDays+" "+MN[lmY%100-1];
  function vs(a,b,pts,fn){var d=a-b;if(a==null||b==null||!lmLab)return"";return'<span class="m2nw '+(d>=0?"up":"dn")+'" title="Compared with the same days of last month">'+(d>=0?"▲":"▼")+(fn?fn(Math.abs(d)):pts?Math.abs(d).toFixed(1)+" pts":fmt(Math.abs(d)))+' vs '+lmLab+'</span>'}
  function kpi(lab2,a,t,st,g,fc,vsTxt,p){var w=t?Math.min(100,a/t*100):0,c=st.k==="behind"?"bad":st.k==="slight"?"warn":"ok";
    return'<div class="m2kpi"><div class="m2kl">'+lab2+'</div><div class="m2kv">'+fmt(a)+(t?'<small>/ '+fmt(t)+'</small>':"")+'</div>'+
      (t?'<div class="m2pb"><i class="'+c+'" style="width:'+w.toFixed(1)+'%"></i><b style="left:'+(p*100).toFixed(1)+'%" title="Where you would usually be by now"></b></div>':'<div class="m2pb"></div>')+
      '<div class="m2ks">'+chip(st,g)+(t&&fc!=null?'<span class="m2nw">Pace → <b>'+fmt(fc)+'</b> by '+M.days+' '+M.sh+'</span>':"")+vsTxt+'</div></div>'}
  var hero='<section class="m2hero '+mood+'" id="ccMonth" aria-label="This month"><div class="m2eye"><span class="cc-live"></span>'+M.name+' · '+M.d+' of '+M.days+' days complete'+(ctx?' · '+ctx:"")+'</div>'+
    '<div class="m2story"><div><h2 class="m2h">'+head+'</h2><p class="m2sub">'+sub+'</p><div class="m2day"><span>'+(M.d?'By day '+M.d+' you usually have <b>'+Math.round(M.pB*100)+'%</b> of a month’s bookings and <b>'+Math.round(M.pW*100)+'%</b> of its walk-ins'+(M.patB&&M.patW?(M.coPat?" (whole-company pattern, last 3 months; too little "+esc(pName(F.proj))+" history)":" (last 3 months)"):M.patB||M.patW?" (partly straight-line: little history)":" (straight-line: little history)"):"First day of the month: pace starts tomorrow")+'.</span></div></div>'+
    '<div class="m2chart"><div class="m2ct"><span>Net bookings so far, added up day by day'+(ctx?' · '+ctx:"")+'</span><span>'+(TG.b?"target "+TG.b:"no target")+'</span></div>'+m2Chart(M,TG.b)+
    '<div class="m2lg">'+(TG.b?'<span><i class="tg"></i>Target pace</span>':"")+'<span><i class="ac"></i>Actual</span><span><i class="fc"></i>At current pace</span></div></div></div>'+
    '<div class="m2kpis'+(HAS_BK?" four":"")+'">'+kpi("Net bookings",S.net,TG.b,bs,gb,fcB,vs(S.net,L.net),M.pB)+kpi("Fresh walk-ins",S.fresh,pnt?null:TG.w,ws,gw,fcW,pnt?"":vs(S.fresh,L.fresh),M.pW).replace('<span class="m2chip none">No target set</span>',pnt?'<span class="m2chip none">Not tagged</span>'+(TG.w?'<span class="m2nw">target '+fmt(TG.w)+'</span>':""):'<span class="m2chip none">No target set</span>')+
    '<div class="m2kpi"><div class="m2kl">Walk-in to booking</div><div class="m2kv">'+(pnt?"–":fp(S.conv))+'</div><div class="m2pb"><i class="ok" style="width:'+(pnt?0:Math.min(100,(S.conv||0)*5)).toFixed(1)+'%;background:linear-gradient(90deg,#FDE68A,#FCD34D)"></i></div><div class="m2ks"><span>'+fmt(S.net)+' net bookings ÷ '+fmt(S.fresh)+' fresh walk-ins</span>'+(!pnt&&S.conv!=null&&L.conv!=null?vs(S.conv,L.conv,1):"")+'</div></div>'+
    (HAS_BK?'<div class="m2kpi"><div class="m2kl">Sales value</div><div class="m2kv" title="₹'+fmt(Math.round(S.sv||0))+' excl. GST and stamp duty">'+fcr(S.sv)+'</div><div class="m2pb" style="visibility:hidden"></div><div class="m2ks">'+'<span class="m2nw"><b>'+sqf(S.sqft)+'</b> sold</span>'+(pOne(F.proj)&&S.rpsf?'<span class="m2nw"><b>₹'+fmt(Math.round(S.rpsf))+'</b> /sq ft</span>':"")+''+(S.tatM!=null?'<span class="m2nw">TAT <b>'+Math.round(S.tatM)+'</b> days</span>':"")+vs(S.sv,L.sv,0,fcr)+'</div></div>':"")+
    '</div></section>';
  // ② needs your attention
  var items=m2Attention(M,PR,fl),nR=items.filter(function(i){return i.lvl===2}).length,nA=items.length-nR,show=ui.attAll?items:items.slice(0,3);
  var att='<section class="card m2att" id="ccAlerts"><div class="m2ch"><h2>Needs your attention</h2>'+(nR?'<span class="cnt r">'+nR+' urgent</span>':"")+(nA?'<span class="cnt a">'+nA+' to watch</span>':"")+'</div>'+
    (items.length?'<div class="m2list">'+show.map(function(it){return m2Item(it,M,S.conv)}).join("")+'</div>'+(items.length>3?'<button class="reset m2more" data-ui="attAll" data-uv="'+(ui.attAll?"":"1")+'">'+(ui.attAll?"Show fewer":"+ "+(items.length-3)+" more")+'</button>':"")
      :(TG.b||TG.w?'<div class="allok"><span class="okic">'+ic("check")+'</span><div><b>Nothing needs your attention</b><span>Everything with a target is on pace, and no other checks raised a flag.</span></div></div>'
        :'<div class="allok skip"><span class="okic">–</span><div><b>Nothing urgent, but pace can’t be judged</b><span>There is no '+M.name+' target for this view yet.</span></div></div>'))+
    '<p class="m2foot">Tap an item to see the numbers behind it.</p></section>';
  // ③ projects scoreboard
  var sel=F.proj,all=ui.pcmp==="all",rows=PR.list.filter(function(x){return!sel||all||pHas(sel,x.p)});
  if(sel&&all)rows.sort(function(a,b){return pHas(sel,b.p)-pHas(sel,a.p)});
  var mute=[];if(!sel&&(PR.none.fresh||PR.none.net))mute.push({p:"Project not entered",s:PR.none,tg:{b:null,w:null},st:["Tag project","m"],mute:1});
  if(!sel&&PR.unt.n)mute.push({p:"Targets not yet tagged (“All”)",s:{net:0,fresh:0,conv:null},tg:{b:PR.unt.b||null,w:PR.unt.w||null},st:["Tag target","m"],mute:1});
  var all2=rows.concat(mute);
  var tbl='<table class="m2tbl"><thead><tr><th>Project</th><th>Net bookings vs target</th><th>Fresh walk-ins vs target</th><th>Conv.</th>'+(HAS_BK?'<th>Sales value</th>':"")+'<th></th></tr></thead><tbody>'+
    all2.map(function(x){var at=x.mute?"":' data-cproj="'+esc(x.p)+'" tabindex="0"';return'<tr class="'+(x.mute?"mute":"m2row")+(sel&&pHas(sel,x.p)?" on":"")+'"'+at+'><td class="m2pj">'+esc(x.p)+'</td><td>'+m2Bar(x.s.net,x.tg.b,M.cB)+'</td><td>'+m2Walk(x,M)+'</td><td>'+(M.nt?"–":fp(x.s.conv))+'</td>'+(HAS_BK?'<td class="m2sv">'+(x.mute?"–":'<b>'+fcr(x.s.sv)+'</b>'+(x.s.rpsf?'<small>₹'+fmt(Math.round(x.s.rpsf))+'/sq ft</small>':"")+(x.s.sf||x.s.sfx?'<small>'+sqf(x.s.sqft)+'</small>':""))+'</td>':"")+'<td><span class="m2stt '+x.st[1]+'">'+x.st[0]+'</span></td></tr>'}).join("")+'</tbody>'+
    (!sel||(pMulti(sel)&&!all)?'<tfoot><tr><td class="m2pj">'+(sel?"Selected total":"Total")+'</td><td>'+m2Bar(S.net,TG.b,M.pB)+'</td><td>'+(sel?m2Walk({s:S,tg:TG},M):m2Bar(S.fresh,TG.w,M.pW))+'</td><td>'+(sel&&M.nt?"–":fp(S.conv))+'</td>'+(HAS_BK?'<td class="m2sv"><b>'+fcr(S.sv)+'</b><small>'+sqf(S.sqft)+'</small></td>':"")+'<td></td></tr></tfoot>':"")+'</table>';
  var cards='<div class="m2cards">'+all2.map(function(x){var at=x.mute?"":' data-cproj="'+esc(x.p)+'"';return'<div class="m2pc'+(x.mute?" mute":"")+(sel&&pHas(sel,x.p)?" on":"")+'"'+at+'><div class="m2ph"><b>'+esc(x.p)+'</b><span class="m2stt '+x.st[1]+'">'+x.st[0]+'</span></div><div class="m2pr"><span>Bookings</span>'+m2Bar(x.s.net,x.tg.b,M.cB)+'</div><div class="m2pr"><span>Walk-ins</span>'+m2Walk(x,M)+'</div>'+(HAS_BK&&!x.mute&&x.s.gross?'<div class="m2pv"><b>'+fcr(x.s.sv)+'</b>'+(x.s.rpsf?' · ₹'+fmt(Math.round(x.s.rpsf))+'/sq ft':"")+' · '+sqf(x.s.sqft)+'</div>':"")+'</div>'}).join("")+'</div>';
  var proj='<section class="card m2proj" id="ccProj"><div class="m2ch"><h2>Projects this month</h2><span class="sub">'+(sel?esc(pName(sel))+" selected":"vs target · biggest gap first · tap a project to focus the page")+'</span>'+
    (sel?togs("pcmp",[["one",pMulti(sel)?"Selected only":esc(lab(sel))+" only"],["all","All projects"]],all?"all":"one"):"")+'</div>'+(all2.length?tbl+cards:empty("No walk-ins, bookings or targets for "+M.name+" yet"))+
    (M.nt?'<div class="m2ntn">'+(PR.none.fresh&&!sel?fmt(PR.none.fresh)+" of "+fmt(S.fresh):Math.round(M.nt)+"% of this month’s")+' fresh walk-ins have no project, so walk-ins can’t be judged by project. Fill column B in the Walk-in sheet.</div>':"")+
    '<div class="m2key"><span><b></b>where you’d usually be by now (bookings '+Math.round(M.cB*100)+'%, walk-ins '+Math.round(M.cW*100)+'%)</span><span>Targets: Closing Targets (bookings) and Sourcing Targets (walk-ins), rolled up by project</span></div></section>';
  // ④ one quiet line about data trust
  var dR=dc.filter(function(x){return x.lvl===2}).length,dA=dc.filter(function(x){return x.lvl===1}).length,lag=D.lastV?M.T-D.lastV:-1,bits=[];
  if(PR.none.fresh)bits.push("<b>"+fmt(PR.none.fresh)+" of "+fmt(S.fresh)+"</b> walk-ins this month have no project");
  if(PR.unt.n)bits.push("<b>"+PR.unt.n+"</b> target row"+(PR.unt.n>1?"s":"")+" still say “All”");
  bits.push(lag<0?"no walk-ins match these filters":"last walk-in entered "+dl(D.lastV)+(lag>2?" ("+lag+" days ago)":""));
  var trust='<div class="m2trust '+(dR?"bad":dA?"warn":"ok")+'"><span aria-hidden="true">'+ic(dR||dA?"warn":"check")+'</span><span>'+bits.join(" · ")+'</span><button class="reset" data-ui="m2data" data-uv="'+(ui.m2data?"":"1")+'">'+(ui.m2data?"Hide data checks":"Data checks"+(dR||dA?" ("+(dR+dA)+")":"")+" ›")+'</button></div>';
  // phone: section bar that sticks to the top while scrolling
  var nav='<nav class="cc-nav" aria-label="Command Centre sections"><button data-jump="ccMonth">Month</button><button data-jump="ccAlerts">Attention'+(items.length?' <b class="'+(nR?"":"a")+'">'+items.length+'</b>':"")+'</button><button data-jump="ccProj">Projects</button></nav>';
  return hero+nav+att+proj+trust+(ui.m2data?dataHtml(dc):"");
}
setInterval(function(){var c=document.getElementById("ccClock");if(c)c.textContent=ccClock()},30000);

/* ---------- main render ---------- */
var charts=[];
/* ---------- admin: people, their rights per project, and a change log (writes go to Supabase; only admins may) ---------- */
var ADM={m:[],a:[],log:[],open:"",loaded:false,busy:false,err:"",view:"people"};
function toast(t){var d=document.createElement("div");d.className="atoast";d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove()},1800)}
function admLoad(){if(!SB||!SESSION)return;ADM.busy=true;
  Promise.all([SB.from("members").select("*").order("email"),SB.from("access").select("*"),SB.from("audit_log").select("*").order("at",{ascending:false}).limit(40)]).then(function(r){
    ADM.busy=false;var e=r.filter(function(x){return x.error})[0];ADM.err=e?e.error.message:"";ADM.m=r[0].data||[];ADM.a=r[1].data||[];ADM.log=r[2].data||[];ADM.loaded=true;if(tab==="admin")admRender()})}
function admRights(email){var o={};ADM.a.forEach(function(x){if(x.email===email)o[x.project]=x});return o}
function admSummary(email){var R=admRights(email),mg=[],st=[],ct=[];for(var p in R){var n=p==="*"?"all projects":p;if(R[p].management)mg.push(n);else if(R[p].control_tower)ct.push(n);if(R[p].site_head)st.push(n)}
  return[mg.length?"Management: "+mg.join(", "):"",ct.length?"Control Tower: "+ct.join(", "):"",st.length?"Site Head: "+st.join(", "):""].filter(Boolean).join(" · ")||"No rights yet"}
/* ---------- access log (supabase/access-log.sql): screens are recorded from here, visits by the server ---------- */
function logA(ev,screen,detail){try{if(!SB||!SB.rpc||!SESSION)return Promise.resolve();var ua=navigator.userAgent,dv=/iPad|Tablet/i.test(ua)?"Tablet":/Mobi|Android|iPhone/i.test(ua)?"Phone":"Laptop";
  return Promise.resolve(SB.rpc("log_access",{p_event:ev,p_screen:screen||null,p_detail:detail||null,p_device:dv})).then(function(){},function(){})}catch(e){return Promise.resolve()}}
var SCR_LAST="";
function trackScreen(){if(!ME||document.hidden)return;
  var s=tab==="cmd"?"Command Centre":tab==="mgmt"?"Management":tab==="site"?"Site Head":"Admin",
    d=tab==="admin"?(ADM.view==="email"?"Emails":ADM.view==="log"?"Access log":"People and rights"):tab==="cmd"?"":(tab==="site"?[sLab()]:[]).concat(focus?[(tab==="site"&&REC[focus])||M(focus).label]:[]).filter(Boolean).join(" · "),k=s+"|"+d;
  if(k===SCR_LAST)return;SCR_LAST=k;logA("screen",s,d)}
/* admin: access log view */
var ALG={sum:[],rows:[],loaded:false,busy:false,missing:false,err:"",who:"",scr:"",days:30,more:false};
var ALG_N=100,ALG_EV={signin:"Signed in",signout:"Signed out",open:"Opened the dashboard",screen:"Screen"};
function algQ(from){var q=SB.from("access_log").select("*").gte("at",new Date(Date.now()-ALG.days*864e5).toISOString());if(ALG.who)q=q.eq("email",ALG.who);
  if(ALG.scr)q=ALG.scr==="signin"||ALG.scr==="open"||ALG.scr==="signout"?q.eq("event",ALG.scr):q.eq("screen",ALG.scr);
  return q.order("at",{ascending:false}).order("id",{ascending:false}).range(from,from+ALG_N-1)}
var ALG_T=0;
function algLoad(more){if(!SB||!SESSION)return;var my=++ALG_T;ALG.busy=true;
  Promise.all([more?Promise.resolve({data:ALG.sum}):SB.rpc("access_summary"),algQ(more?ALG.rows.length:0)]).then(function(r){if(my!==ALG_T)return;
    ALG.busy=false;ALG.loaded=true;var e=r.filter(function(x){return x.error})[0];
    ALG.missing=!!(e&&(/42P01|PGRST202|PGRST205/.test(e.error.code||"")||/does not exist|schema cache|could not find/i.test(e.error.message||"")));ALG.err=e&&!ALG.missing?e.error.message:"";
    if(!e){ALG.sum=r[0].data||[];var d=r[1].data||[];ALG.rows=more?ALG.rows.concat(d):d;ALG.more=d.length===ALG_N}
    if(tab==="admin"&&ADM.view==="log")admRender()},function(x){if(my!==ALG_T)return;ALG.busy=false;ALG.loaded=true;ALG.err=String(x&&x.message||x);if(tab==="admin"&&ADM.view==="log")admRender()})}
function algT(t){return t?new Date(t).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}):"–"}
function algClock(t){return new Date(t).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",hour:"numeric",minute:"2-digit"})}
function algName(em){var m=ADM.m.filter(function(x){return x.email===em})[0];return m&&m.full_name||em}
function algRender(){
  if(!ALG.loaded){if(!ALG.busy)algLoad();return'<section class="card"><h2>Access log</h2><div class="sub">Loading…</div></section>'}
  if(ALG.missing)return'<section class="card hwarn" role="alert"><h2>One step first</h2><div class="sub" style="margin:0">Run <b>supabase/access-log.sql</b> once in Supabase → SQL Editor, then open this tab again.</div></section>';
  var act={};ADM.m.forEach(function(m){act[m.email]=m.active});
  var ppl=ALG.sum.map(function(s){var off=act[s.email]===false;return'<tr class="click" data-adm="logwho" data-em="'+esc(s.email)+'"><td><b>'+esc(algName(s.email))+'</b>'+(off?'<span class="atag off">Switched off</span>':s.last_visit?"":'<span class="atag bad">Never opened</span>')+'<div class="dim" style="font-size:12px">'+esc(s.email)+'</div></td><td>'+esc(algT(s.last_visit))+'</td><td>'+fmt(+s.visits7||0)+'</td><td>'+fmt(+s.visits30||0)+'</td><td>'+esc(s.top_screen||"–")+'</td></tr>'}).join("");
  var never=ALG.sum.filter(function(s){return!s.last_visit&&act[s.email]!==false}).length;
  var rows=ALG.rows.map(function(l){var what=l.event==="screen"?l.screen||"":ALG_EV[l.event]||l.event,vis=l.event==="open"&&l.last_at&&new Date(l.last_at)-new Date(l.at)>6e4?" · until "+algClock(l.last_at):"";
    return'<tr><td style="white-space:nowrap">'+esc(algT(l.at))+'</td><td>'+esc(algName(l.email))+'</td><td>'+(l.event==="screen"?esc(what):'<b>'+esc(what)+'</b>')+(l.detail?' <span class="dim">'+esc(l.detail)+'</span>':"")+'<span class="dim">'+esc(vis)+'</span></td><td>'+esc(l.device||"–")+'</td></tr>'}).join("");
  var op=function(v,t,c){return'<option value="'+esc(v)+'"'+(String(c)===String(v)?" selected":"")+'>'+esc(t)+'</option>'};
  var fl='<div class="algf"><label>Person <select data-alg="who">'+op("","Everyone",ALG.who)+ADM.m.map(function(m){return op(m.email,m.full_name||m.email,ALG.who)}).join("")+'</select></label><label>Show <select data-alg="scr">'+op("","Everything",ALG.scr)+op("open","Dashboard visits",ALG.scr)+op("signin","Sign-ins",ALG.scr)+op("signout","Sign-outs",ALG.scr)+["Command Centre","Management","Site Head","Admin"].map(function(s){return op(s,s+" screen",ALG.scr)}).join("")+'</select></label><label>Period <select data-alg="days">'+[[1,"Last 24 hours"],[7,"Last 7 days"],[30,"Last 30 days"],[90,"Last 90 days"],[180,"Last 180 days"]].map(function(d){return op(d[0],d[1],ALG.days)}).join("")+'</select></label><button class="abtn ghost" data-adm="logref">Refresh</button></div>';
  return(ALG.err?'<section class="card hwarn" role="alert">'+esc(ALG.err)+'</section>':"")+
    '<section class="card"><h2>People</h2><div class="sub">Who uses the dashboard'+(never?' · <b>'+never+'</b> not opened it yet':"")+'. Tap a person to see their activity.</div><table class="admt algp"><thead><tr><th>Person</th><th>Last visit</th><th>Visits, 7 days</th><th>Visits, 30 days</th><th>Most used screen</th></tr></thead><tbody>'+(ppl||'<tr><td>No people yet.</td></tr>')+'</tbody></table></section>'+
    '<section class="card" id="algAct"><h2>Activity</h2><div class="sub">Latest first, India time. A visit lasts while the dashboard stays open and refreshing; the same screen counts once in 5 minutes. Kept for 180 days.</div>'+fl+'<table class="alog"><thead><tr><th>When</th><th>Person</th><th>What</th><th>Device</th></tr></thead><tbody>'+(rows||'<tr><td colspan="4">Nothing recorded for this selection.</td></tr>')+'</tbody></table>'+(ALG.more?'<button class="abtn ghost" data-adm="logmore" style="margin-top:8px">'+(ALG.busy?"Loading…":"Load more")+'</button>':"")+'</section>';
}
document.addEventListener("change",function(e){var k=e.target.getAttribute&&e.target.getAttribute("data-alg");if(!k)return;ALG[k]=k==="days"?+e.target.value:e.target.value;algLoad()});
function admRender(){var el=$("adm");if(!SB||!SESSION||!(ME&&ME.admin)){el.innerHTML='<section class="card"><h2>Admin</h2><div class="sub">Sign in as an admin to manage people.</div></section>';return}
  if(!ADM.loaded){el.innerHTML='<section class="card"><h2>People and rights</h2><div class="sub">Loading…</div></section>';if(!ADM.busy)admLoad();return}
  var projs=projList().filter(function(p){return p&&p!=="All"}).sort();
  var rows=ADM.m.map(function(m){var open=ADM.open===m.email,me=SESSION.user&&SESSION.user.email===m.email;
    var tr='<tr><td><b>'+esc(m.full_name||m.email)+'</b>'+(m.is_admin?'<span class="atag adm1">Admin</span>':"")+(m.active?"":'<span class="atag off">Switched off</span>')+'<div class="dim" style="font-size:12px">'+esc(m.email)+'</div></td><td style="white-space:normal">'+esc(m.is_admin&&!ADM.a.some(function(x){return x.email===m.email})?"Admin: sees everything":admSummary(m.email))+'</td><td><button class="abtn ghost" data-adm="open" data-em="'+esc(m.email)+'">'+(open?"Close":"Edit rights")+'</button></td></tr>';
    if(open){var R=admRights(m.email),cb=function(p,k){var on=R[p]&&R[p][k],lab=(k==="management"?"Management":k==="control_tower"?"Control Tower":"Site Head")+' for '+esc(p==="*"?"all projects":p);
        // Management already includes the Control Tower
        if(k==="control_tower"&&((R[p]&&R[p].management)||(R["*"]&&R["*"].management)))return'<input type="checkbox" class="cov" checked disabled title="Included in Management" aria-label="'+lab+', included in Management">';
        // "All projects" ticked: each project is already covered, so its tick shows greyed out and can't be changed
        if(p!=="*"&&R["*"]&&R["*"][k])return'<input type="checkbox" class="cov" checked disabled title="Covered by All projects" aria-label="'+lab+', covered by All projects">';
        return'<input type="checkbox" data-acc="'+k+'" data-em="'+esc(m.email)+'" data-pj="'+esc(p)+'"'+(on?" checked":"")+' aria-label="'+lab+'">'};
      tr+='<tr><td colspan="3"><div class="agrid"><table><thead><tr><th>Project</th><th>Control Tower</th><th>Management</th><th>Site Head</th></tr></thead><tbody><tr class="all"><td>All projects, including future ones</td><td>'+cb("*","control_tower")+'</td><td>'+cb("*","management")+'</td><td>'+cb("*","site_head")+'</td></tr>'+
        projs.map(function(p){return'<tr><td>'+esc(p)+'</td><td>'+cb(p,"control_tower")+'</td><td>'+cb(p,"management")+'</td><td>'+cb(p,"site_head")+'</td></tr>'}).join("")+'</tbody></table>'+
        '<div class="note">Control Tower = Control Tower tab only. Management = Control Tower and Management tabs. Site Head = Site Head tab, including customer names. Greyed ticks are covered by “All projects”. Changes save at once and apply the next time the person loads the dashboard.</div>'+
        '<div class="aact"><button class="abtn ghost" data-adm="copy" data-em="'+esc(m.email)+'">Copy invite message</button>'+(me?"":'<button class="abtn ghost" data-adm="active" data-em="'+esc(m.email)+'">'+(m.active?"Switch off access":"Switch access back on")+'</button><button class="abtn danger" data-adm="remove" data-em="'+esc(m.email)+'">Remove person</button>')+'</div></div></td></tr>'}
    return tr}).join("");
  var logRows=ADM.log.map(function(l){return'<tr><td style="white-space:nowrap">'+esc(new Date(l.at).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}))+'</td><td>'+esc(l.actor||"system")+'</td><td>'+esc(admLogText(l))+'</td></tr>'}).join("");
  var seg='<div class="aseg" role="tablist" aria-label="Admin sections"><button role="tab" data-adm="view" data-v="people" aria-selected="'+(ADM.view!=="email"&&ADM.view!=="log")+'">People and rights</button><button role="tab" data-adm="view" data-v="email" aria-selected="'+(ADM.view==="email")+'">Emails</button><button role="tab" data-adm="view" data-v="log" aria-selected="'+(ADM.view==="log")+'">Access log</button></div>';
  if(ADM.view==="email"){el.innerHTML=seg+emlRender();return}
  if(ADM.view==="log"){el.innerHTML=seg+algRender();return}
  el.innerHTML=seg+(ADM.err?'<section class="card hwarn" role="alert">'+esc(ADM.err)+'</section>':"")+
    '<section class="card"><h2>People and rights</h2><div class="sub">Add a person, then tick what they may see for each project. They create their own password with "Create account" on the sign-in screen.</div>'+
    '<form class="admadd" id="admAdd"><input type="email" id="admEmail" placeholder="Email" required><input type="text" id="admName" placeholder="Full name"><button class="abtn" type="submit">Add person</button></form>'+
    '<table class="admt" style="margin-top:12px"><thead><tr><th>Person</th><th>Can see</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></section>'+
    '<section class="card"><h2>Change log</h2><div class="sub">Who gave or removed access, and when (latest 40).</div><table class="alog"><tbody>'+(logRows||'<tr><td>No changes yet.</td></tr>')+'</tbody></table></section>';
}
function admLogText(l){var d=l.detail||{},a=d.after||d,b=d.before;
  if(/^access/.test(l.action)){var w=[a.management?"Management":a.control_tower?"Control Tower":"",a.site_head?"Site Head":""].filter(Boolean).join(" + ");var pj=a.project==="*"?"all projects":a.project;
    if(/delete/.test(l.action))return"Removed all rights on "+pj+" for "+a.email;return(w?"Gave "+w:"Removed rights")+" on "+pj+" to "+a.email}
  if(/insert/.test(l.action))return"Added "+(a.full_name?a.full_name+" ("+a.email+")":a.email);
  if(/delete/.test(l.action))return"Removed "+a.email;
  if(b&&b.active!==a.active)return(a.active?"Switched access back on for ":"Switched off access for ")+a.email;
  return"Updated "+a.email}
function admSave(p,okText){ADM.busy=true;return p.then(function(r){ADM.busy=false;if(r&&r.error){toast(/control_tower/.test(r.error.message||"")?"Not saved: run supabase/control-tower.sql in Supabase first":"Not saved: "+r.error.message);ADM.loaded=false;admRender();return}toast(okText||"Saved");admLoad()})}
document.addEventListener("submit",function(e){if(e.target.id!=="admAdd")return;e.preventDefault();
  var em=$("admEmail").value.trim().toLowerCase(),nm=$("admName").value.trim();if(!/^\S+@\S+\.\S+$/.test(em)){toast("Enter a valid email");return}
  if(ADM.m.some(function(m){return m.email===em})){ADM.open=em;admRender();return}
  ADM.open=em;admSave(SB.from("members").insert({email:em,full_name:nm||null}),"Added "+em+". Now tick their rights.")});
document.addEventListener("change",function(e){var c=e.target;if(!c.matches||!c.matches("[data-acc]"))return;
  var em=c.getAttribute("data-em"),pj=c.getAttribute("data-pj"),k=c.getAttribute("data-acc"),R=admRights(em)[pj]||{},row={email:em,project:pj,management:!!R.management,site_head:!!R.site_head};row[k]=c.checked;
  // the Control Tower column exists only after supabase/control-tower.sql; leave it out of rows that don't need it
  if(k==="control_tower"||R.control_tower!==undefined)row.control_tower=k==="control_tower"?c.checked:!!R.control_tower;
  admSave(!row.management&&!row.site_head&&!row.control_tower?SB.from("access").delete().eq("email",em).eq("project",pj):SB.from("access").upsert(row))});
function admAction(x){var a=x.getAttribute("data-adm"),em=x.getAttribute("data-em");
  if(a==="view"){ADM.view=x.getAttribute("data-v");if(ADM.view==="log"&&ALG.loaded){ALG.loaded=false}trackScreen();admRender();return}
  if(a==="logref"){algLoad();return}
  if(a==="logmore"){if(!ALG.busy)algLoad(true);return}
  if(a==="logwho"){ALG.who=em;algLoad();var ac=$("algAct");if(ac)ac.scrollIntoView({behavior:"auto",block:"start"});return}
  if(/^em/.test(a)){emlAction(a,x);return}
  if(a==="open"){ADM.open=ADM.open===em?"":em;admRender();return}
  if(a==="copy"){var m=ADM.m.filter(function(z){return z.email===em})[0]||{},msg="Hi"+(m.full_name?" "+m.full_name.split(" ")[0]:"")+", you now have access to the Raghav Realty Control Tower.\n\nOpen "+location.origin+location.pathname+" and choose \"Create account\". Use this email: "+em+"\nYou will get an email to confirm it; after that, sign in with your new password.";
    (navigator.clipboard?navigator.clipboard.writeText(msg):Promise.reject()).then(function(){toast("Invite message copied")},function(){window.prompt("Copy this message:",msg)});return}
  if(a==="active"){var m2=ADM.m.filter(function(z){return z.email===em})[0];admSave(SB.from("members").update({active:!m2.active}).eq("email",em),m2.active?"Access switched off":"Access switched back on");return}
  if(a==="remove"){if(!confirm("Remove "+em+" and all their rights? They will no longer be able to sign in to see data."))return;ADM.open="";admSave(SB.from("members").delete().eq("email",em),"Removed "+em)}}
document.addEventListener("click",function(e){var x=e.target.closest&&e.target.closest("[data-adm]");if(x){e.preventDefault();admAction(x)}});
/* ---------- admin: scheduled management emails (setups in Supabase "email_jobs", sends logged in "email_sends") ---------- */
var EML={jobs:[],sends:[],loaded:false,busy:false,err:"",missing:false,ed:null,prev:null,phone:false};
var EM_SEC=[["decisions","Decisions for you","biggest ₹ impact first: what happened, why and the choice to make"],["channel","Direct against partner, and cancellations","is the direct price lower only by the commission saved; partner share; cancellations"],["realisation","₹ per sq ft","column in the project table, against the last 3 months; price cuts on the same configuration"]];
var EM_LISTS=[["to_list","To"],["cc_list","Cc"],["bcc_list","Bcc"]];
function emlLoad(){if(!SB||!SESSION)return;EML.busy=true;
  Promise.all([SB.from("email_jobs").select("*").order("name"),SB.from("email_sends").select("*").order("at",{ascending:false}).limit(30)]).then(function(r){
    EML.busy=false;var e=r.filter(function(x){return x.error})[0];EML.missing=!!(e&&(e.error.code==="42P01"||/does not exist|schema cache/i.test(e.error.message||"")));
    EML.err=e&&!EML.missing?e.error.message:"";EML.jobs=r[0].data||[];EML.sends=r[1].data||[];EML.loaded=true;if(tab==="admin"&&ADM.view==="email")admRender()})}
function emHour(h){return(h%12||12)+":00 "+(h<12?"AM":"PM")}
function emOrd(d){return d+(d%10===1&&d!==11?"st":d%10===2&&d!==12?"nd":d%10===3&&d!==13?"rd":"th")}
function emProj(p){return!p||p.indexOf("*")>=0?"All projects":p.join(", ")}
function emYms(){var out=[],y=SalesReport.lastFullMonth();for(var i=0;i<6;i++){var Y=+y.slice(0,4),M=+y.slice(5,7)-1-i;Y+=Math.floor(M/12);M=((M%12)+12)%12;out.push(Y+"-"+(M<9?"0":"")+(M+1))}return out}
function emBlank(){return{id:null,name:"Monthly sales report",active:true,projects:["*"],to_list:[],cc_list:[],bcc_list:[],day_of_month:1,send_hour:9,sections:{decisions:true,cards:true,channel:true,realisation:true},ym:SalesReport.lastFullMonth()}}
// read what is typed on the editor into the draft before anything re-draws it
function emlSync(){var d=EML.ed;if(!d||!$("emName"))return;d.name=$("emName").value;d.active=$("emActive").checked;d.day_of_month=+$("emDay").value;d.send_hour=+$("emHour").value;d.ym=$("emYm").value;
  EM_SEC.forEach(function(s){var c=$("emS_"+s[0]);if(c)d.sections[s[0]]=c.checked});
  if($("emAll").checked)d.projects=["*"];else d.projects=[].slice.call(document.querySelectorAll("[data-emp]")).filter(function(c){return c.checked}).map(function(c){return c.getAttribute("data-emp")});
  EM_LISTS.forEach(function(l){var i=document.querySelector('.chipin[data-l="'+l[0]+'"]');if(i&&i.value.trim())emAddChip(l[0],i.value)})}
function emAddChip(l,v){var d=EML.ed,bad=[];String(v).split(/[,;\s]+/).forEach(function(s){s=s.trim().toLowerCase();if(!s)return;if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)){bad.push(s);return}if(d[l].indexOf(s)<0)d[l].push(s)});if(bad.length)toast("Not an email: "+bad.join(", "));return!bad.length}
function emlRender(){
  if(!EML.loaded){if(!EML.busy)emlLoad();return'<section class="card"><h2>Emails</h2><div class="sub">Loading…</div></section>'}
  if(EML.missing)return'<section class="card hwarn" role="alert"><h2>One step first</h2><div class="sub" style="margin:0">Run <b>supabase/email.sql</b> once in Supabase → SQL Editor, then open this tab again.</div></section>';
  var h=(EML.err?'<section class="card hwarn" role="alert">'+esc(EML.err)+'</section>':"")+(EML.ed?emlEditor():emlList());
  var hist=EML.sends.map(function(s){return'<tr><td style="white-space:nowrap">'+esc(new Date(s.at).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}))+'</td><td>'+esc(s.job_name||"")+'</td><td>'+esc(s.period?ymLab(+s.period.replace("-","")):"")+'</td><td>'+(s.kind==="test"?"Test to "+esc(s.sent_by||""):s.kind==="manual"?"Sent now · "+fmt(s.to_count||0)+" recipients · by "+esc(s.sent_by||""):"Scheduled · "+fmt(s.to_count||0)+" recipients")+'</td><td>'+(s.ok?'<span class="atag ok">Sent</span>':'<span class="atag bad" title="'+esc(s.error||"")+'">Failed</span> <span class="dim">'+esc((s.error||"").slice(0,80))+'</span>')+'</td></tr>'}).join("");
  return h+'<section class="card"><h2>Send history</h2><div class="sub">Every email sent from here, latest 30.</div><table class="alog"><tbody>'+(hist||'<tr><td>Nothing sent yet.</td></tr>')+'</tbody></table></section>';
}
function emlList(){
  var rows=EML.jobs.map(function(j){var n=(j.to_list||[]).length,c=(j.cc_list||[]).length,b=(j.bcc_list||[]).length;
    return'<tr><td><b>'+esc(j.name)+'</b>'+(j.active?'<span class="atag ok">On</span>':'<span class="atag off">Paused</span>')+'<div class="dim" style="font-size:12px">'+esc(emProj(j.projects))+'</div></td><td style="white-space:normal">'+(n?"To "+n:'<span style="color:var(--bad)">No recipient</span>')+(c?" · Cc "+c:"")+(b?" · Bcc "+b:"")+'<div class="dim" style="font-size:12px">'+esc(emOrd(j.day_of_month)+" of each month, "+emHour(j.send_hour)+" IST")+'</div></td><td><button class="abtn ghost" data-adm="emedit" data-id="'+esc(j.id)+'">Edit</button></td></tr>'}).join("");
  return'<section class="card"><h2>Scheduled emails</h2><div class="sub">Each email reports the last full month for the projects you pick, from noreply@raghavgroup.in. Automatic monthly sending comes later; for now open an email and use “Send test to me” to check it, then “Send now to recipients” to send it to its To, Cc and Bcc.</div>'+
    '<button class="abtn" data-adm="emnew">New email</button>'+
    (rows?'<table class="admt" style="margin-top:12px"><thead><tr><th>Email</th><th>Recipients · schedule</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>':'<div class="note" style="margin-top:10px">No emails set up yet.</div>')+'</section>';
}
function emlEditor(){var d=EML.ed,all=d.projects.indexOf("*")>=0,projs=projList().filter(function(p){return p&&p!=="All"}).sort();
  var people=ADM.m.filter(function(m){return m.active}).map(function(m){return'<option value="'+esc(m.email)+'">'+esc(m.full_name||"")+'</option>'}).join("");
  var chips=EM_LISTS.map(function(l){return'<div class="erow"><label class="elab">'+l[1]+'</label><div class="echips">'+d[l[0]].map(function(e,i){return'<span class="echip">'+esc(e)+'<button type="button" data-adm="emchipx" data-l="'+l[0]+'" data-i="'+i+'" aria-label="Remove '+esc(e)+'">×</button></span>'}).join("")+
    '<input class="chipin" data-l="'+l[0]+'" list="emPeople" type="email" placeholder="'+(d[l[0]].length?"Add another":"Add a person or any email")+'" aria-label="Add '+l[1]+' recipient"></div></div>'}).join("");
  var days="";for(var i=1;i<=28;i++)days+='<option value="'+i+'"'+(i===d.day_of_month?" selected":"")+'>'+emOrd(i)+'</option>';
  var hrs="";for(var k=6;k<=22;k++)hrs+='<option value="'+k+'"'+(k===d.send_hour?" selected":"")+'>'+emHour(k)+'</option>';
  var yms=emYms().map(function(y){return'<option value="'+y+'"'+(y===d.ym?" selected":"")+'>'+ymLab(+y.replace("-",""))+'</option>'}).join("");
  var pj='<label class="echk all"><input type="checkbox" id="emAll"'+(all?" checked":"")+'> All projects, including future ones</label>'+projs.map(function(p){var on=all||d.projects.indexOf(p)>=0;return'<label class="echk'+(all?" cov":"")+'"><input type="checkbox" data-emp="'+esc(p)+'"'+(on?" checked":"")+(all?' disabled title="Covered by All projects"':"")+'> '+esc(p)+'</label>'}).join("");
  var secs=EM_SEC.map(function(s){return'<label class="echk wide"><input type="checkbox" id="emS_'+s[0]+'"'+(d.sections[s[0]]!==false?" checked":"")+'> <b>'+s[1]+'</b> <span class="dim">'+s[2]+'</span></label>'}).join("");
  return'<section class="card" id="emEd"><h2>'+(d.id?"Edit email":"New email")+'</h2><div class="sub">Headline, the 4 numbers (sales value, net bookings, walk-ins, conversion), the project table and the link to the Control Tower are always in. Pick the rest below.</div>'+
    '<div class="erow"><label class="elab" for="emName">Name</label><input id="emName" class="einp" maxlength="120" value="'+esc(d.name)+'"><label class="echk" style="margin-left:8px"><input type="checkbox" id="emActive"'+(d.active?" checked":"")+'> On</label></div>'+
    '<datalist id="emPeople">'+people+'</datalist><div class="egroup"><div class="eh">Recipients</div>'+chips+'<div class="note">Pick from the people list or type any email; press Enter after each.</div></div>'+
    '<div class="egroup"><div class="eh">Projects in this email</div><div class="egrid">'+pj+'</div></div>'+
    '<div class="egroup"><div class="eh">When</div><div class="erow"><label class="elab" for="emDay">Day</label><select id="emDay" class="einp sm">'+days+'</select><label class="elab" for="emHour" style="width:auto;margin-left:6px">at</label><select id="emHour" class="einp sm">'+hrs+'</select><span class="dim">India time · reports the month before</span></div></div>'+
    '<div class="egroup"><div class="eh">Sections</div>'+secs+'</div>'+
    '<div class="egroup"><div class="erow"><label class="elab" for="emYm">Preview month</label><select id="emYm" class="einp sm">'+yms+'</select><span class="dim">for Preview, Send test and Send now</span></div></div>'+
    '<div class="aact"><button class="abtn" data-adm="emsave">Save</button><button class="abtn ghost" data-adm="emprev">Preview</button><button class="abtn ghost" data-adm="emtest">Send test to me</button>'+(d.id?'<button class="abtn ghost" data-adm="emsend">Send now to recipients</button>':"")+'<button class="abtn ghost" data-adm="emback">Back</button>'+(d.id?'<button class="abtn danger" data-adm="emdel">Delete</button>':"")+'</div></section>';
}
function emPayload(d){return{id:d.id,name:d.name.trim()||"Sales report",projects:d.projects,sections:d.sections,ym:d.ym}}
function emPreview(){var d=EML.ed,o;try{o=SalesReport.build(DATA,{ym:d.ym,projects:d.projects,sections:d.sections,url:location.origin+location.pathname})}catch(e){toast("Could not build the preview");console.error(e);return}
  EML.prev=o;var m=$("emModal");if(!m){m=document.createElement("div");m.id="emModal";m.className="emodal";document.body.appendChild(m)}
  m.innerHTML='<div class="ebox" role="dialog" aria-modal="true" aria-label="Email preview"><div class="ebar"><div><div class="dim" style="font-size:11.5px">Subject</div><b>'+esc(o.subject)+'</b></div><div class="eacts"><div class="aseg sm"><button data-emv="d" aria-selected="'+!EML.phone+'">Desktop</button><button data-emv="p" aria-selected="'+EML.phone+'">Phone</button></div><button class="abtn ghost" data-emx="1" aria-label="Close preview">Close</button></div></div><div class="eframe'+(EML.phone?" ph":"")+'"><iframe title="Email preview" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe></div></div>';
  m.querySelector("iframe").srcdoc=o.html;m.hidden=false}
document.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;var m=$("emModal");if(!m||m.hidden)return;
  if(t.closest("[data-emx]")||t===m){m.hidden=true;return}
  var v=t.closest("[data-emv]");if(v){EML.phone=v.getAttribute("data-emv")==="p";emPreview()}});
document.addEventListener("keydown",function(e){var m=$("emModal");if(e.key==="Escape"&&m&&!m.hidden)m.hidden=true;
  var i=e.target;if(i.classList&&i.classList.contains("chipin")&&(e.key==="Enter"||e.key===","||e.key===";")){e.preventDefault();if(!i.value.trim())return;emlSync();admRender();var n=document.querySelector('.chipin[data-l="'+i.getAttribute("data-l")+'"]');if(n)n.focus()}});
document.addEventListener("change",function(e){var c=e.target;if(c.id==="emAll"){emlSync();admRender()}
  // a pick from the people list adds the chip at once
  else if(c.classList&&c.classList.contains("chipin")&&/@/.test(c.value)&&ADM.m.some(function(m){return m.email===c.value.trim().toLowerCase()})){emlSync();admRender()}});
function emlAction(a,x){
  if(a==="emnew"){EML.ed=emBlank();admRender();return}
  if(a==="emedit"){var j=EML.jobs.filter(function(z){return z.id===x.getAttribute("data-id")})[0];if(!j)return;
    EML.ed={id:j.id,name:j.name,active:j.active,projects:(j.projects||["*"]).slice(),to_list:(j.to_list||[]).slice(),cc_list:(j.cc_list||[]).slice(),bcc_list:(j.bcc_list||[]).slice(),day_of_month:j.day_of_month,send_hour:j.send_hour,sections:Object.assign({decisions:true,cards:true,channel:true,realisation:true},j.sections||{}),ym:SalesReport.lastFullMonth()};admRender();return}
  if(a==="emback"){EML.ed=null;admRender();return}
  emlSync();var d=EML.ed;if(!d)return;
  if(a==="emchipx"){d[x.getAttribute("data-l")].splice(+x.getAttribute("data-i"),1);admRender();return}
  if(!d.projects.length){toast("Pick at least one project");admRender();return}
  if(a==="emprev"){admRender();emPreview();return}
  if(a==="emsave"){if(!d.name.trim()){toast("Give the email a name");return}if(d.active&&!d.to_list.length){toast("Add at least one To recipient, or switch it off");admRender();return}
    var row={name:d.name.trim(),active:d.active,projects:d.projects,to_list:d.to_list,cc_list:d.cc_list,bcc_list:d.bcc_list,day_of_month:d.day_of_month,send_hour:d.send_hour,sections:d.sections};
    (d.id?SB.from("email_jobs").update(row).eq("id",d.id).select():SB.from("email_jobs").insert(row).select()).then(function(r){if(r.error){toast("Not saved: "+r.error.message);return}toast("Saved");if(r.data&&r.data[0])d.id=r.data[0].id;emlLoad()});return}
  if(a==="emdel"){if(!confirm("Delete “"+d.name+"”? Its send history stays."))return;SB.from("email_jobs").delete().eq("id",d.id).then(function(r){if(r.error){toast("Not deleted: "+r.error.message);return}toast("Deleted");EML.ed=null;emlLoad()});return}
  if(a==="emsend"){if(x.disabled||!d.id)return;
    // sends what is SAVED; refuse if the screen has changes that are not saved yet
    var j=EML.jobs.filter(function(z){return z.id===d.id})[0],same=function(a,b){return JSON.stringify(a||[])===JSON.stringify(b||[])};
    if(!j||j.name!==d.name.trim()||!same(j.projects,d.projects)||!same(j.to_list,d.to_list)||!same(j.cc_list,d.cc_list)||!same(j.bcc_list,d.bcc_list)||JSON.stringify(Object.assign({decisions:true,cards:true,channel:true,realisation:true},j.sections||{}))!==JSON.stringify(d.sections)){toast("You have changes that are not saved. Save first, then Send now.");admRender();return}
    if(!d.to_list.length){toast("Add at least one To recipient and save");return}
    var n=d.to_list.length+d.cc_list.length+d.bcc_list.length,mon=ymLab(+d.ym.replace("-","")),
      before=EML.sends.filter(function(s){return s.job_id===d.id&&s.kind==="manual"&&s.ok&&s.period===d.ym})[0];
    var msg="Send “"+d.name.trim()+"” for "+mon+" to "+n+" "+(n===1?"person":"people")+" now?\n\nTo: "+d.to_list.join(", ")+(d.cc_list.length?"\nCc: "+d.cc_list.join(", "):"")+(d.bcc_list.length?"\nBcc: "+d.bcc_list.join(", "):"")+
      (before?"\n\nNote: this email was already sent for "+mon+" on "+new Date(before.at).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"})+".":"")+"\n\nThis cannot be undone.";
    if(!confirm(msg))return;
    x.disabled=true;x.textContent="Sending…";
    fetch("/api/email",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+SESSION.access_token},body:JSON.stringify({action:"send",job:emPayload(d)})})
      .then(function(r){return r.json().catch(function(){return{message:"Server said "+r.status}}).then(function(j){return{ok:r.ok,j:j}})})
      .then(function(o){toast(o.ok?"Sent to "+o.j.count+" "+(o.j.count===1?"person":"people"):"Not sent: "+(o.j.message||o.j.error||"unknown"));emlLoad()},function(){toast("Not sent: no connection")})
      .then(function(){x.disabled=false;x.textContent="Send now to recipients"});return}
  if(a==="emtest"){if(x.disabled)return;x.disabled=true;x.textContent="Sending…";
    fetch("/api/email",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+SESSION.access_token},body:JSON.stringify({action:"test",job:emPayload(d)})})
      .then(function(r){return r.json().catch(function(){return{message:"Server said "+r.status}}).then(function(j){return{ok:r.ok,j:j}})})
      .then(function(o){toast(o.ok?"Test sent to "+o.j.to:"Not sent: "+(o.j.message||o.j.error||"unknown"));emlLoad()},function(){toast("Not sent: no connection")})
      .then(function(){x.disabled=false;x.textContent="Send test to me"});return}
}
function render(){
  if(!DATA)return;
  trackScreen();
  $("tabAdm").setAttribute("aria-selected",tab==="admin");APP.classList.toggle("admtab",tab==="admin");
  if(tab==="admin"){["tabCmd","tabMgmt","tabSite"].forEach(function(i){$(i).setAttribute("aria-selected","false")});admRender();return}
  renderFilters();
  var P=period(F.per),Pv=prevOf(P),weekly=!!P.month;
  var S=stats(F,P),PS=Pv?stats(F,Pv):null;if(PS)PS.P=Pv;
  var TG=tab==="site"?{bookM:{},walkM:{},why:"Targets are set per manager, not per project"}:targets(F,P),ser=series(F,P,weekly);
  var serM=weekly?series(F,P,false):ser; // achievement is always measured by month
  $("tabCmd").setAttribute("aria-selected",tab==="cmd");$("tabMgmt").setAttribute("aria-selected",tab==="mgmt");$("tabSite").setAttribute("aria-selected",tab==="site");
  charts=[];
  document.querySelector(".app").classList.toggle("cmdtab",tab==="cmd");
  $("lPer").style.display=tab==="cmd"?"none":"";$("cmd").style.display=tab==="cmd"?"":"none";$("tiles").style.display=tab==="cmd"?"none":"";
  if(tab==="cmd"){
    $("focus").style.display="none";$("vis").style.display="none";$("vis").innerHTML="";
    $("cmd").innerHTML=cmdHtml();
  }else if(tab==="mgmt"){
    renderTiles(mgmtTiles(),P,S,PS,TG,serM);
    if(focus){$("vis").style.display="none";$("focus").style.display="";renderFocus(P,S,PS,TG,ser,weekly,serM)}
    else{
      $("focus").style.display="none";$("vis").style.display="";
      var tr=trendCard(P,TG,ser,weekly,"cTrend",ui.trend,true);
      $("vis").innerHTML=tr.html+projCard(P)+closingCard(P)+sourcingCard(P)+channelCard(P,ui.chan)+whyCard(P,ui.why,"cWhy");
      charts.push(["#cTrend .plot",tr.items,{alt:ui.trend==="walk",aria:"trend",ach:tr.ach}]);
    }
  }else{
    renderTiles(siteTiles(),P,S,PS,TG,serM);
    if(focus&&REC[focus]){$("vis").style.display="none";$("focus").style.display="";$("focus").innerHTML=recHtml(focus,P)}
    else{
      focus=null;$("focus").style.display="none";$("vis").style.display="";
      var st=trendCard(P,TG,ser,weekly,"sTrend",ui.strend,false);
      $("vis").innerHTML=st.html+teamCard(P)+siteSrcCard(P,ui.ssrc)+cpCard(P)+fixCard(P)+discCard(P);
      charts.push(["#sTrend .plot",st.items,{alt:ui.strend==="walk",aria:"trend"}]);
    }
  }
  $("hwarn").innerHTML=hdrWarn();document.querySelector(".app").classList.toggle("sitetab",tab==="site");$("vis").classList.toggle("site",tab==="site");
  var det=isPhone()&&(tab==="mgmt"||tab==="site")&&!!focus;APP.classList.toggle("detail",det);
  if(det)$("dtitle").textContent=tab==="site"?(REC[focus]||M(focus).label):M(focus).label;
  drawCharts();
  var q=DATA.Q;
  $("srcnote").innerHTML='<span>Source: '+esc(DATA.file||"All Data.xlsx")+' — Walk-in, Closing Targets, Sourcing Targets, Inventory Status</span><span>'+fmt(q.rows)+' walk-in rows · '+fmt(INV.length)+' units</span>'+(q.noVisitDate||q.noFreshRevisit?'<span title="Rows the sheet is missing values for">Data gaps: '+fmt(q.noVisitDate)+' without visit date, '+fmt(q.noFreshRevisit)+' without Fresh/Revisit</span>':"")+'<span>Customer names are shown only to Site Head users. Phone, email and remarks are never loaded.</span>';
}
function drawCharts(){charts.forEach(function(c){var el=document.querySelector(c[0]);if(el){colChart(el,c[1],c[2]);if(c[2].ach){var a=el.parentNode.querySelector(".achp");if(a)achChart(a,c[1],el)}}})}
// achievement % by month, in its own panel under the bars (never a second axis on the bar chart):
// one point per month = actual ÷ target; dashed 100% line; the running month is hollow, "to date",
// with a tick where you would usually be by today
function achChart(el,items,plot){
  var W=Math.max(260,plot.clientWidth||400),H=68,l=6,r=6,n=items.length,bw=(W-l-r)/n,top=14,bot=6,h=H-top-bot;
  var P=items.map(function(it){return it.t>0?Math.round(it.v/it.t*100):null}),mx=Math.max(120,Math.min(200,Math.max.apply(null,P.map(function(p){return p||0}))*1.1));
  var y=function(p){return top+h-Math.min(p,mx)/mx*h},cx=function(i){return l+i*bw+bw/2};
  var exp=null;if(items.some(function(it){return it.cur&&it.t>0})){var M=m2Month();m2Pace(M);exp=Math.round(M.pB*100)}
  var st=function(p,it){var b=it.cur&&exp!=null?exp:100;return p>=b?"good":p>=b*.8?"warn":"bad"};
  var s='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="Achievement against target by month">';
  s+='<line class="a100" x1="'+l+'" x2="'+(W-r)+'" y1="'+y(100).toFixed(1)+'" y2="'+y(100).toFixed(1)+'"/>';
  // join neighbouring months that both have a target; the step into the running month is dashed
  for(var i=1;i<n;i++)if(P[i]!=null&&P[i-1]!=null)s+='<line class="aln'+(items[i].cur?" dash":"")+'" x1="'+cx(i-1).toFixed(1)+'" y1="'+y(P[i-1]).toFixed(1)+'" x2="'+cx(i).toFixed(1)+'" y2="'+y(P[i]).toFixed(1)+'"/>';
  s+='</svg>';
  var lab='<span class="ay" style="top:'+y(100).toFixed(1)+'px">100%</span>',prevLy=null;
  P.forEach(function(p,i){var it=items[i];if(p==null){lab+='<span class="anone" style="left:'+(cx(i)/W*100).toFixed(2)+'%">–</span>';return}
    var c=st(p,it),tip=it.lab+": "+fmt(it.v)+" of "+fmt(it.t)+" = "+p+"%"+(it.cur?" so far · usual by today "+exp+"%":"");
    var xp=cx(i)/W*100,ed=xp>90?" r":xp<10?" l":"",ly=y(p)-15;if(prevLy!=null&&Math.abs(ly-prevLy)<12)ly=y(p)+5;prevLy=ly;lab+='<span class="adot '+c+(it.cur?" cur":"")+'" style="left:'+(cx(i)/W*100).toFixed(2)+'%;top:'+y(p).toFixed(1)+'px" title="'+esc(tip)+'"></span><span class="apc '+c+ed+'" style="left:'+(cx(i)/W*100).toFixed(2)+'%;top:'+ly.toFixed(1)+'px">'+(p>mx?"&gt;":"")+Math.min(p,999)+'%</span>';
    if(it.cur&&exp!=null)lab+='<span class="aexp" style="left:'+(cx(i)/W*100).toFixed(2)+'%;top:'+y(exp).toFixed(1)+'px" title="Where you would usually be by today: '+exp+'% of the month’s target"></span>'});
  el.innerHTML='<div class="ahd"><span>Achieved vs target</span><span class="alg"><i class="good"></i>100%+<i class="warn"></i>80–99%<i class="bad"></i>below 80%<i class="cur"></i>this month so far</span></div><div class="aplot" style="height:'+H+'px">'+s+lab+'</div>';
}

/* ---------- loading ---------- */
function setLive(){var el=$("live"),t=$("liveTxt");if(!DATA){t.textContent=loadErr||"Loading…";return}
  var d=new Date(DATA.asOf),age=(Date.now()-d.getTime())/6e4;el.className="live"+(age>15||loadErr?" stale":"");
  var ed=DATA.sheetModified?new Date(DATA.sheetModified):d,o={timeZone:"Asia/Kolkata",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"};
  t.innerHTML=(loadErr?"Offline · ":"")+'Updated <span class="lu">as on </span>'+esc(ed.toLocaleString("en-IN",o));
  el.title="Sheet last edited "+ed.toLocaleString("en-IN",o)+" (any change to All Data.xlsx). Dashboard last checked the sheet at "+d.toLocaleString("en-IN",o)+" and checks again every 5 minutes.";}
var LD_STEPS=["Connecting to the Google Sheet…","Reading walk-ins…","Matching bookings and cancellations…","Lining up targets…","Opening the Control Tower…"],ldI=0,ldT=null;
function ldStart(){var el=$("loading");el.classList.remove("out");el.style.display="";ldI=0;$("loadMsg").className="ldstep";$("loadMsg").textContent=LD_STEPS[0];$("ldBar").style.width="8%";
  clearInterval(ldT);ldT=setInterval(function(){if(ldI>=LD_STEPS.length-1)return;ldI++;var m=$("loadMsg");m.classList.add("fade");setTimeout(function(){m.textContent=LD_STEPS[ldI];m.classList.remove("fade")},250);$("ldBar").style.width=(8+ldI*20)+"%"},1100)}
function ldDone(){clearInterval(ldT);var el=$("loading");if(el.style.display==="none")return;$("ldBar").style.width="100%";$("loadMsg").textContent="Ready";
  setTimeout(function(){el.classList.add("out");var a=document.querySelector(".app");a.classList.add("enter");setTimeout(function(){el.style.display="none";a.classList.remove("enter")},1100)},250)}
function ldFail(msg){clearInterval(ldT);var m=$("loadMsg");m.className="ldstep bad";m.textContent=msg}
/* ---------- sign-in (Supabase): each person has their own login; the server trims data to their rights ---------- */
var SB_URL="https://iqazttfvyaihzktfvuzq.supabase.co",SB_ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxYXp0dGZ2eWFpaHprdGZ2dXpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUyMzM2MTQsImV4cCI6MjExMDgwOTYxNH0.iGGgHGRH-kE1_QibRoiy3sz8_6M0rE_f0KnPi94zmx4";
var SB=null,SESSION=null,ME=null,ALLOW=null,AMODE="signin";
try{if(window.supabase)SB=window.supabase.createClient(SB_URL,SB_ANON,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}})}catch(e){SB=null}
function authShow(mode,msg){AMODE=mode;$("loading").style.display="none";$("gate").style.display="none";$("auth").style.display="";
  var T={signin:["Sign in to the Control Tower",msg||"Use the email your admin gave access to.","Sign in"],signup:["Create your account","Your admin must add your email first. Choose a password of at least 8 characters.","Create account"],
    forgot:["Reset your password","We will email you a link to set a new password.","Send reset link"],reset:["Set a new password","At least 8 characters.","Save password"],
    noaccess:["No access yet",msg||"Your account has no projects yet. Ask the admin to give you access.","Sign out"]}[mode];
  $("authT").textContent=T[0];$("authP").textContent=T[1];$("authBtn").textContent=T[2];
  $("authEmail").hidden=mode==="reset"||mode==="noaccess";$("authPass").hidden=mode==="forgot"||mode==="noaccess";$("authPass2").hidden=!(mode==="signup"||mode==="reset");
  $("authPass").autocomplete=mode==="signin"?"current-password":"new-password";$("authErr").textContent="";$("authOk").textContent="";
  $("authLinks").innerHTML=mode==="signin"?'<button type="button" data-amode="signup">Create account</button><button type="button" data-amode="forgot">Forgot password?</button>':mode==="noaccess"?"":'<button type="button" data-amode="signin">Back to sign in</button>';
  setTimeout(function(){var el=!$("authEmail").hidden?$("authEmail"):!$("authPass").hidden?$("authPass"):$("authBtn");el.focus()},30)}
function authErrText(m){m=String(m||"");if(/invalid login/i.test(m))return"Wrong email or password.";if(/not confirmed/i.test(m))return"Confirm your email first: open the link we sent you, then sign in.";
  if(/database error|not been given access/i.test(m))return"This email has not been given access. Ask the admin to add you first.";if(/already registered|already been registered/i.test(m))return"An account already exists for this email. Sign in, or use Forgot password.";
  if(/rate limit|too many/i.test(m))return"Too many attempts. Wait a few minutes and try again.";return m}
function authBusy(b){$("authBtn").disabled=b}
document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[data-eye]");if(!b)return;var i=$(b.getAttribute("data-eye")),show=i.type==="password";i.type=show?"text":"password";b.classList.toggle("on",show);b.setAttribute("aria-label",show?"Hide password":"Show password")});
$("authForm").addEventListener("submit",function(e){e.preventDefault();if(!SB)return;
  var em=$("authEmail").value.trim().toLowerCase(),pw=$("authPass").value,pw2=$("authPass2").value,err=$("authErr"),ok=$("authOk");err.textContent="";ok.textContent="";
  var bad=function(t){err.textContent=t};
  if(AMODE==="noaccess"){SB.auth.signOut();return}
  if(AMODE!=="reset"&&!/^\S+@\S+\.\S+$/.test(em))return bad("Enter your email.");
  if((AMODE==="signup"||AMODE==="reset")&&pw.length<8)return bad("Use at least 8 characters.");
  if((AMODE==="signup"||AMODE==="reset")&&pw!==pw2)return bad("The two passwords are not the same.");
  if(AMODE==="signin"&&!pw)return bad("Enter your password.");
  authBusy(true);var back=location.origin+location.pathname;
  var p=AMODE==="signin"?SB.auth.signInWithPassword({email:em,password:pw}):AMODE==="signup"?SB.auth.signUp({email:em,password:pw,options:{emailRedirectTo:back}}):
    AMODE==="forgot"?SB.auth.resetPasswordForEmail(em,{redirectTo:back}):SB.auth.updateUser({password:pw});
  p.then(function(r){authBusy(false);if(r.error)return bad(authErrText(r.error.message));
    if(AMODE==="signin"&&r.data&&r.data.session){SCR_LAST="";setTimeout(function(){logA("signin")},1200)}
    if(AMODE==="signup"&&!r.data.session)ok.textContent="Almost done: open the confirmation link we emailed you, then sign in.";
    else if(AMODE==="forgot")ok.textContent="If this email has an account, a reset link is on its way.";
    else if(AMODE==="reset"){ok.textContent="Password saved.";history.replaceState(null,"",back);setTimeout(function(){$("auth").style.display="none";ldStart();load()},600)}
  }).catch(function(x){authBusy(false);bad(authErrText(x&&x.message))})});
document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[data-amode]");if(b){e.preventDefault();authShow(b.getAttribute("data-amode"))}});
// account button: "Sign in" when signed out (optional mode), or the person's menu
function acctPaint(){var b=$("acct");if(!SB||!SESSION){b.hidden=true;return}b.hidden=false;b.textContent=ME&&ME.name?ME.name.split(" ")[0]:"Account"}
$("acct").onclick=function(e){e.stopPropagation();if(!SESSION){authShow("signin");return}var m=$("acctMenu");
  if(!m.hidden){m.hidden=true;return}m.innerHTML='<b>'+esc(ME&&ME.name||"Signed in")+'</b><small>'+esc(SESSION.user&&SESSION.user.email||"")+'</small><button type="button" id="signout">Sign out</button>';m.hidden=false;
  $("signout").onclick=function(){var go=function(){if(go.d)return;go.d=1;SCR_LAST="";SB.auth.signOut()};logA("signout").then(go);setTimeout(go,1500)}};
document.addEventListener("click",function(e){if(!e.target.closest(".acct"))$("acctMenu").hidden=true});
// what this person may see: tabs and projects (the server already removed everything else)
// projects a tab may show: Site Head, Management, or Control Tower (Management includes the Control Tower)
function alw(t){if(!ALLOW)return null;t=t||tab;return t==="site"?ALLOW.st:t==="mgmt"?ALLOW.mgT:ALLOW.mg}
function applyRights(me){ME=me||null;
  if(!ME){ALLOW=null;$("tabAdm").hidden=true;["tabCmd","tabMgmt","tabSite"].forEach(function(i){$(i).hidden=false});acctPaint();return}
  var cv=ME.ct||ME.mg,set=function(v){return v==="*"?null:new Set(v)},none=function(v){return v!=="*"&&!v.length};
  // mg = Control Tower projects (used by the Control Tower tab), mgT = Management projects (Management tab)
  ALLOW={mg:set(cv),mgT:set(ME.mg),st:set(ME.st),ctNone:none(cv),mgNone:none(ME.mg),stNone:none(ME.st)};
  $("tabCmd").hidden=ALLOW.ctNone;$("tabMgmt").hidden=ALLOW.mgNone;$("tabSite").hidden=ALLOW.stNone;$("tabAdm").hidden=!ME.admin;APP.classList.toggle("nomg",ALLOW.mgNone);
  if(tab==="mgmt"&&ALLOW.mgNone)tab="cmd";
  if(tab==="cmd"&&ALLOW.ctNone)tab=ALLOW.stNone?(ME.admin?"admin":"cmd"):"site";
  if(tab==="site"&&ALLOW.stNone)tab=ALLOW.ctNone?(ME.admin?"admin":"cmd"):"cmd";
  if(tab==="admin"&&!ME.admin)tab="cmd";
  if(alw()&&F.proj)F.proj=pKeep(F.proj,alw());
  acctPaint()}
function load(fresh){
  var key=store("dashKey")||"",hd={};if(key)hd["x-dashboard-key"]=key;if(SESSION&&SESSION.access_token)hd.Authorization="Bearer "+SESSION.access_token;
  return fetch("api/data"+(fresh?"?fresh=1":""),{headers:hd,cache:"no-store"}).then(function(r){
    if(r.status===403)return r.json().catch(function(){return{}}).then(function(j){authShow("noaccess",(j.email?j.email+" has":"Your account has")+" no projects yet. Ask the admin to give you access.");throw new Error("password")});
    if(r.status===401)return r.json().catch(function(){return{}}).then(function(j){
      if(j.error==="login"){if(SESSION){SB.auth.signOut()}authShow("signin");throw new Error("password")}
      $("loading").style.display="none";$("gate").style.display="";if(key)$("gateErr").textContent="That password did not work.";$("gatePass").focus();throw new Error("password")});
    if(!r.ok)return r.json().catch(function(){return{}}).then(function(j){throw new Error(j.message||("Server error "+r.status))});
    return r.json();
  }).then(function(d){
    loadErr="";ingest(d);applyRights(d.me);lastLoad=Date.now();$("gate").style.display="none";$("auth").style.display="none";
    if(tab==="site"&&F.proj)F.proj=pSel(F.proj).filter(function(q){return q!=="All"}).join(PSEP);
    render();setLive();ldDone();
  }).catch(function(e){if(e.message==="password")return;loadErr="Could not load data";setLive();if(!DATA){ldFail("Could not load the data: "+e.message+". Try again in a minute.")}});
}

/* ---------- events ---------- */
/* phone: a tile opens a full-screen detail page with its own history entry, so Back / swipe-back return to the dashboard */
var APP=document.querySelector(".app"),detY=0,NOMO=matchMedia("(prefers-reduced-motion:reduce)");
function isPhone(){return matchMedia("(max-width:760px)").matches}
function openDetail(id){detY=window.scrollY;if(tab==="site"){ui.rst="all";ui.rq=""}focus=id;
  if(!(history.state&&history.state.d))history.pushState({d:id},"");else history.replaceState({d:id},"");
  render();window.scrollTo(0,0)}
function closeDetail(){var was=APP.classList.contains("detail");focus=null;APP.classList.remove("leaving");render();
  if(was){window.scrollTo(0,detY);if(!NOMO.matches){APP.classList.add("back");setTimeout(function(){APP.classList.remove("back")},320)}}}
function goBack(){if(history.state&&history.state.d){if(NOMO.matches){history.back();return}APP.classList.add("leaving");setTimeout(function(){history.back()},200)}else closeDetail()}
/* hover preview of the (i) card on mouse devices; a click pins it */
document.addEventListener("mouseover",function(e){if(!CAN_HOVER.matches||isPhone())return;var b=e.target.closest&&e.target.closest("[data-info]");
  if(b){clearTimeout(kpT);if(kpBtn!==b&&!kpPinned)kpT=setTimeout(function(){kpOpen(b,false)},150)}
  else if(e.target.closest&&e.target.closest("#kpop"))clearTimeout(kpT)});
document.addEventListener("mouseout",function(e){if(!kpBtn||kpPinned)return;var to=e.relatedTarget;
  if(to&&to.closest&&(to.closest("#kpop")||to.closest("[data-info]")===kpBtn))return;
  clearTimeout(kpT);kpT=setTimeout(function(){if(!kpPinned)kpClose(false)},200)});
window.addEventListener("scroll",function(){if(kpBtn&&!isPhone()&&CAN_HOVER.matches)kpClose(false)},{passive:true});
window.addEventListener("popstate",function(){if(focus)closeDetail()});
$("dback").onclick=goBack;
function setTab(t){if(ALLOW&&((t==="site"&&ALLOW.stNone)||(t==="cmd"&&ALLOW.ctNone)||(t==="mgmt"&&ALLOW.mgNone)))return;if(t==="admin"&&!(ME&&ME.admin))return;
  // Site Head works on one project: several ticks are put aside and come back on the other tabs

  if(alw(t)&&F.proj)F.proj=pKeep(F.proj,alw(t));
  if(t==="site"&&F.proj)F.proj=pSel(F.proj).filter(function(q){return q!=="All"}).join(PSEP);
  tab=t;focus=null;$("flt").classList.toggle("site1",t==="site");render()}
var PKEEP=null;

// a site head works on a real project: "All" in column B is not one
function siteProj(){var p=projList().filter(function(x){return x!=="All"&&(!ALLOW||!ALLOW.st||ALLOW.st.has(x))});return p[0]||""}
document.addEventListener("click",function(e){
  var t=e.target,x;
  if(t.closest("#kclose")||t.id==="kscrim"){kpClose(true);return}
  if((x=t.closest("[data-info]"))){if(kpBtn===x&&kpPinned)kpClose(true);else kpOpen(x,true);return}
  if(t.closest("#kpop"))return;
  if(kpBtn)kpClose(false);
  if((x=t.closest("[data-tab]"))){setTab(x.getAttribute("data-tab"));return}
  if((x=t.closest("[data-ccat]"))){var cv=x.getAttribute("data-ccat");ui.ccat=ui.ccat===cv?"":cv;render();
    if(isPhone()&&ui.ccat){var al=$("ccAlerts");if(al)al.scrollIntoView({behavior:NOMO.matches?"auto":"smooth",block:"start"})}return}
  if((x=t.closest("[data-jump]"))){var je=$(x.getAttribute("data-jump"));if(je){if(je.tagName==="DETAILS")je.open=true;je.scrollIntoView({behavior:NOMO.matches?"auto":"smooth",block:"start"})}return}
  if((x=t.closest("[data-cproj]"))){F.proj=x.getAttribute("data-cproj");ui.fdimPicked=0;ui.pcmp="";render();window.scrollTo({top:0,behavior:NOMO.matches?"auto":"smooth"});return}
  if((x=t.closest("[data-cmdopen]"))){var k=x.getAttribute("data-cmdopen"),pp=x.getAttribute("data-p"),ss=x.getAttribute("data-s");
    if(ALLOW&&(ALLOW.mgNone||(ALLOW.mgT&&pSel(pp||F.proj).some(function(q){return q&&!ALLOW.mgT.has(q)}))))return;
    tab="mgmt";F.per=x.getAttribute("data-per")||"l30";ui.fdimPicked=0;if(pp)F.proj=pp;if(ss)F.src=ss;
    if(isPhone()&&k){openDetail(k)}else{focus=k||null;render();window.scrollTo(0,0)}return}
  if((x=t.closest("[data-cpnew]"))){ui.cpnew=!ui.cpnew;render();var nl=document.querySelector(".cpnew");if(ui.cpnew&&nl)nl.scrollIntoView({behavior:NOMO.matches?"auto":"smooth",block:"nearest"});return}
  if((x=t.closest("[data-unfocus]"))){if(APP.classList.contains("detail"))goBack();else{focus=null;render()}return}
  if((x=t.closest("[data-tile]"))&&tab==="site"){var sid=x.getAttribute("data-tile");
    if(sid==="cpf"){var cpc=$("sCp");if(focus){focus=null;render();cpc=$("sCp")}if(cpc)cpc.scrollIntoView({behavior:NOMO.matches?"auto":"smooth",block:"start"});return}
    if(sid==="nr"&&M("nr").ph){var ib=x.querySelector("[data-info]");if(ib)kpOpen(ib,true);return}
    if(isPhone()){openDetail(sid);return}
    ui.rst="all";ui.rq="";focus=focus===sid?null:sid;render();window.scrollTo({top:0,behavior:NOMO.matches?"auto":"smooth"});return}
  if(x&&isPhone()){openDetail(x.getAttribute("data-tile"));return}
  if(x){var id=x.getAttribute("data-tile");focus=focus===id?null:id;render();window.scrollTo({top:0,behavior:"smooth"});return}
  if((x=t.closest("[data-ui]"))){ui[x.getAttribute("data-ui")]=x.getAttribute("data-uv");if(x.getAttribute("data-ui")==="fdim")ui.fdimPicked=1;render();return}
  if((x=t.closest("[data-x]"))){F[x.getAttribute("data-x")]="";ui.fdimPicked=0;render();return}
  if((x=t.closest("[data-per]"))){F.per=normPer(x.getAttribute("data-per"));render();return}
  if((x=t.closest("tr[data-f]"))){var f=x.getAttribute("data-f"),v=x.getAttribute("data-v");F[f]=F[f]===v?"":v;if(f==="cp"&&F.cp&&F.src!=="Indirect")F.src="";render();return}
});
document.addEventListener("keydown",function(e){
  if(e.key==="Enter"&&e.target.matches&&e.target.matches("tr[data-f],tr[data-cproj]")){e.target.click()}
  if((e.key==="Enter"||e.key===" ")&&e.target.matches&&e.target.matches("div[data-tile]")){e.preventDefault();e.target.click()}
  if(e.key==="Escape"&&kpBtn){kpClose(true);return}
  if(e.key==="Tab"&&kpPinned&&isPhone()){e.preventDefault();$("kclose").focus()}
  if(e.key==="Escape"){if($("flt").classList.contains("open"))$("flt").classList.remove("open");else if(focus){if(APP.classList.contains("detail"))goBack();else{focus=null;render()}}}
});
document.addEventListener("input",function(e){if(e.target.id==="rq"&&REC_CTX){ui.rq=e.target.value;$("recList").innerHTML=recListHtml(REC_CTX.id,REC_CTX.P)}});
document.addEventListener("change",function(e){var t=e.target;
  if(/^f(Proj|Cm|Sm|Src)$/.test(t.id))ui.fdimPicked=0;
  if(t.id==="fPer")F.per=t.value;else if(t.id==="fProj")F.proj=t.value;else if(t.id==="fCm")F.cm=t.value;else if(t.id==="fSm")F.sm=t.value;else if(t.id==="fSrc")F.src=t.value;
  else if(t.matches("[data-why]")){if(t.getAttribute("data-why")==="sWhy")ui.swhy=t.value;else ui.why=t.value}else return;
  render();
});
$("freset").onclick=function(){ui.fdimPicked=0;ui.ccat="";Object.assign(F,{per:"mtd",proj:"",cm:"",sm:"",src:"",cp:""});focus=null;render()};
function mProjOpen(o){$("mProjP").hidden=!o;$("mProjB").setAttribute("aria-expanded",o?"true":"false")}
$("mProjB").onclick=function(){mProjOpen($("mProjP").hidden)};
$("mProjP").addEventListener("click",function(e){if(e.target.id==="mProjC"){F.proj="";ui.fdimPicked=0;ui.pcmp="";render()}else if(e.target.id==="mProjD"){mProjOpen(false);$("mProjB").focus()}});
$("mProjP").addEventListener("change",function(e){var p=e.target.getAttribute("data-mp");if(p==null)return;e.stopPropagation();
  if(p==="")F.proj="";else{var l=pSel(F.proj),i=l.indexOf(p);if(i>=0)l.splice(i,1);else l.push(p);F.proj=l.join(PSEP)}
  ui.fdimPicked=0;ui.pcmp="";render()});
document.addEventListener("mousedown",function(e){if(!$("mProjP").hidden&&!e.target.closest("#mProj"))mProjOpen(false)});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!$("mProjP").hidden){mProjOpen(false);$("mProjB").focus()}});
// phone: tab icons, and wide tables shown as one card per row (CSS table.rc); the labels come from the headings
["tabCmd","tabMgmt","tabSite","tabAdm"].forEach(function(i){var s=document.createElement("span");s.className="tbi";s.innerHTML=ic(i);$(i).insertBefore(s,$(i).firstChild)});
var RC_OPEN={};
function rowCards(){[].forEach.call(document.querySelectorAll("#vis table,#focus table,#cmd table,#adm table"),function(t){
  if(t.getAttribute("data-rc")||t.classList.contains("cpw")||t.classList.contains("m2tbl"))return;t.setAttribute("data-rc","1");
  var th=[].map.call(t.querySelectorAll("thead th"),function(x){return x.textContent.trim()}),r0=t.querySelector("tbody tr"),n=th.length||(r0?r0.children.length:0);if(n<4)return;
  t.classList.add("rc");var cells=r0?r0.children.length-1-r0.querySelectorAll("td.bar").length:3;t.style.setProperty("--rc",cells%4===0||cells===2?2:3);
  [].forEach.call(t.querySelectorAll("tbody tr,tfoot tr"),function(r){[].forEach.call(r.children,function(c,i){if(th[i]&&th[i]!=="#")c.setAttribute("data-l",th[i])});
    // a leading rank column ("#") joins the name below it
    if(th[0]==="#"&&r.children.length>1&&!r.getAttribute("data-rk")){r.setAttribute("data-rk","1");r.children[0].style.gridColumn="1 / -1"}});
  var rows=t.querySelectorAll("tbody tr"),id=((t.closest("[id]")||{}).id||"")+"|"+th.join(),lim=6;
  if(rows.length>lim+1){[].forEach.call(rows,function(r,i){if(i>=lim)r.classList.add("xtra")});if(RC_OPEN[id])t.classList.add("all");
    var b=document.createElement("button");b.type="button";b.className="rcmore";b.textContent=RC_OPEN[id]?"Show fewer":"Show all "+fmt(rows.length);b.onclick=function(){RC_OPEN[id]=!RC_OPEN[id];t.classList.toggle("all",RC_OPEN[id]);b.textContent=RC_OPEN[id]?"Show fewer":"Show all "+fmt(rows.length)};
    t.parentNode.insertBefore(b,t.nextSibling)}})}
var rcT=0;new MutationObserver(function(){if(rcT)return;rcT=1;Promise.resolve().then(function(){rcT=0;rowCards()})}).observe(APP,{childList:true,subtree:true});
$("fopen").onclick=function(){$("flt").classList.add("open")};
$("fclose").onclick=function(){$("flt").classList.remove("open")};
$("refresh").onclick=function(){$("liveTxt").textContent="Refreshing…";load(true)};
$("gateForm").onsubmit=function(e){e.preventDefault();store("dashKey",$("gatePass").value);$("gateErr").textContent="";$("gate").style.display="none";ldStart();load()};
var themes=["auto","light","dark"],th=store("dashTheme")||"auto";
function applyTheme(){if(th==="auto")document.documentElement.removeAttribute("data-theme");else document.documentElement.setAttribute("data-theme",th);$("theme").textContent=th==="auto"?"Theme: auto":th==="light"?"Theme: light":"Theme: dark"}
$("theme").onclick=function(){th=themes[(themes.indexOf(th)+1)%3];store("dashTheme",th);applyTheme()};applyTheme();
var tip=$("tip");
document.addEventListener("mousemove",function(e){var x=e.target.closest&&e.target.closest("[data-tip]");if(x&&x.getAttribute("data-tip")){tip.textContent=x.getAttribute("data-tip");tip.style.display="block";var w=tip.offsetWidth;tip.style.left=Math.min(window.innerWidth-w-8,e.clientX+12)+"px";tip.style.top=(e.clientY+14)+"px"}else tip.style.display="none"});
var rz;window.addEventListener("resize",function(){clearTimeout(rz);rz=setTimeout(function(){if(focus)render();else drawCharts()},150)});
setInterval(function(){if(!document.hidden)load()},REFRESH_MS);
document.addEventListener("visibilitychange",function(){if(!document.hidden&&Date.now()-lastLoad>REFRESH_MS)load()});
setInterval(setLive,60000);
window.__dash={F:F,render:render,setTab:setTab,rights:function(me){applyRights(me);render()},focus:function(id){focus=id||null;render()},ui:ui,stats:function(){return stats(F,period(F.per)).tot},targets:function(){return targets(F,period(F.per))}};
// start: wait for a saved sign-in (if any), then load; react to sign-in, sign-out and password-reset links
// no activity for 2 hours: this device is signed out (other devices are not) and the page is cleared
var IDLE_MS=2*36e5,idleSaved=0;
function idleTouch(){var n=Date.now();if(n-idleSaved>3e4){idleSaved=n;store("ctLast",String(n))}}
function idleOver(){var l=+store("ctLast")||0;return l>0&&Date.now()-l>IDLE_MS}
function idleOut(){try{sessionStorage.setItem("ctIdle","1")}catch(e){}store("ctLast",null);var fin=function(){try{Object.keys(localStorage).forEach(function(k){if(/^sb-.*auth-token/.test(k))localStorage.removeItem(k)})}catch(e){}location.reload()};return SB.auth.signOut({scope:"local"}).then(fin,fin)}
function idleCheck(){if(SB&&SESSION&&idleOver())idleOut()}
["pointerdown","keydown","touchstart","wheel"].forEach(function(t){document.addEventListener(t,function(){if(!SESSION||idleOver()){idleCheck();return}idleTouch()},{passive:true,capture:true})});
setInterval(idleCheck,60000);document.addEventListener("visibilitychange",function(){if(!document.hidden)idleCheck()});
if(SB){
  SB.auth.onAuthStateChange(function(ev,s){
    if(ev==="PASSWORD_RECOVERY"){SESSION=s;authShow("reset");return}
    if(ev==="SIGNED_IN"){var had=!!SESSION;SESSION=s;if(!had&&idleOver()){idleOut();return}if(!had){idleSaved=0;idleTouch()}if(!had&&AMODE!=="reset"){$("auth").style.display="none";ldStart();load()}return}
    if(ev==="TOKEN_REFRESHED"||ev==="USER_UPDATED"){SESSION=s;return}
    if(ev==="SIGNED_OUT"){SESSION=null;ME=null;store("ctLast",null);location.reload()}});
  // signed out: the sign-in page comes first (no loading screen); signed in: loading screen, then the Control Tower
  var boot=function(){document.body.classList.remove("booting")};
  SB.auth.getSession().then(function(r){SESSION=r.data.session;acctPaint();boot();if(AMODE==="reset")return;if(SESSION&&idleOver()){idleOut();return}if(SESSION){idleTouch();ldStart();load()}else{store("ctLast",null);var was=null;try{was=sessionStorage.getItem("ctIdle");sessionStorage.removeItem("ctIdle")}catch(e){}authShow("signin",was?"You were signed out after 2 hours without activity.":"")}}).catch(function(){boot();authShow("signin")});
}else{document.body.classList.remove("booting");ldStart();load()}
})();
