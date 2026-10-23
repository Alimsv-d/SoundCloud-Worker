import { STR } from "./i18n.js";
import { escapeHtml as E, fmtDuration } from "./text.js";

const ERRROWS = [
  ["BAD_REQUEST","پارامتر نامعتبر","Invalid parameter"],
  ["NOT_FOUND","پیدا نشد","Not found"],
  ["UNAUTHORIZED","احراز هویت لازم","Auth required"],
  ["RATE_LIMITED","بیش از حد درخواست","Rate limit"],
  ["UPSTREAM_ERROR","خطای منبع","Upstream error"],
  ["UPSTREAM_TIMEOUT","مهلت تمام شد","Timeout"],
  ["PAYLOAD_TOO_LARGE","حجم زیاد","Too large"],
  ["BLOCKED_URL","نشانی مسدود","Blocked"],
  ["NOT_DOWNLOADABLE","دانلود مجاز نیست","No download"],
  ["INTERNAL_ERROR","خطای داخلی","Internal"],
];

export function renderPage({ lang = "fa", nonce = "" } = {}) {
  const s = STR[lang] || STR.fa;
  const errRows = ERRROWS.map(([c, fa, en]) =>
    `<tr><td><code>${c}</code></td><td>${E(lang === "fa" ? fa : en)}</td></tr>`).join("");
  const faq = s.faq.map(([q, a]) =>
    `<details class="reveal"><summary>${E(q)}</summary><p>${E(a)}</p></details>`).join("");

  return `<!DOCTYPE html>
<html lang="${s.lang}" dir="${s.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${E(s.title)}</title>
<meta name="description" content="${E(s.tagline)}">
<script nonce="${nonce}">
// Progressive-enhancement gate: only enable .js when safe.
try {
  if ("IntersectionObserver" in window &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.documentElement.classList.add("js");
  }
} catch (e) {}
// Fallback: reveal everything after 1s no matter what.
setTimeout(function(){ document.querySelectorAll(".reveal").forEach(function(n){ n.style.opacity=1; n.style.transform="none"; }); }, 1000);
</script>
<style nonce="${nonce}">
:root{--bg:#f7f8fb;--fg:#131520;--card:#fff;--mut:#6b7280;--acc:#5b5bd6;--bd:#e5e7eb}
@media(prefers-color-scheme:dark){:root{--bg:#0e0f14;--fg:#e8eaf0;--card:#171a22;--mut:#9aa3b2;--acc:#8b8bf0;--bd:#2a2f3a}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;line-height:1.7}
.wrap{max-width:840px;margin:0 auto;padding:1rem}
header{display:flex;align-items:center;justify-content:space-between;padding:1rem}
.brand{font-weight:700;font-size:1.1rem}
.burger{cursor:pointer;background:none;border:1px solid var(--bd);border-radius:.5rem;padding:.4rem .7rem;color:var(--fg);font-size:1.1rem}
nav{display:none;gap:1rem;padding:0 1rem}
nav.open{display:flex;flex-direction:column}
nav a{color:var(--fg);text-decoration:none;padding:.3rem 0}
.hero{text-align:center;padding:3rem 1rem 2rem}
.hero h1{font-size:2rem;margin:0 0 .5rem}
.hero p{color:var(--mut)}
.search{display:flex;gap:.5rem;max-width:560px;margin:1rem auto}
.search input{flex:1;padding:.8rem 1rem;border:1px solid var(--bd);border-radius:.75rem;background:var(--card);color:var(--fg);font-size:1rem}
.search select{padding:.8rem;border:1px solid var(--bd);border-radius:.75rem;background:var(--card);color:var(--fg)}
.btn{background:var(--acc);color:#fff;border:none;border-radius:.75rem;padding:.8rem 1.2rem;font-size:1rem;cursor:pointer}
.btn.ghost{background:transparent;color:var(--acc);border:1px solid var(--acc)}
.note{font-size:.85rem;color:var(--mut);background:var(--card);border:1px solid var(--bd);border-radius:.75rem;padding:.6rem 1rem;max-width:560px;margin:0 auto}
.grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));margin-top:1.5rem}
.card{background:var(--card);border:1px solid var(--bd);border-radius:1rem;overflow:hidden;display:flex;flex-direction:column}
.card img{width:100%;aspect-ratio:1;object-fit:cover;background:var(--bd)}
.card .b{padding:.8rem;display:flex;flex-direction:column;gap:.4rem;flex:1}
.card .t{font-weight:600}
.card .a{color:var(--mut);font-size:.9rem}
.badges{display:flex;gap:.4rem;flex-wrap:wrap}
.badge{font-size:.7rem;background:var(--bg);border:1px solid var(--bd);border-radius:1rem;padding:.1rem .55rem;color:var(--mut)}
.actions{margin-top:auto;display:flex;gap:.5rem;flex-wrap:wrap}
.actions .btn,.actions a{font-size:.85rem;padding:.5rem .8rem;flex:1;text-align:center;text-decoration:none;border-radius:.6rem}
.actions a{background:transparent;color:var(--acc);border:1px solid var(--acc)}
section{padding:2rem 1rem}
section h2{font-size:1.4rem;margin-bottom:.8rem}
details{background:var(--card);border:1px solid var(--bd);border-radius:.75rem;padding:.8rem 1rem;margin-bottom:.6rem}
summary{cursor:pointer;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{border:1px solid var(--bd);padding:.5rem .7rem;text-align:start}
pre{overflow:auto;background:var(--card);border:1px solid var(--bd);border-radius:.75rem;padding:1rem;direction:ltr;text-align:left;font-size:.82rem}
footer{border-top:1px solid var(--bd);text-align:center;padding:2rem 1rem;color:var(--mut);font-size:.85rem}
footer a{color:var(--acc);text-decoration:none}
audio{width:100%;margin-top:.4rem}
[hidden]{display:none!important}
/* reveal only under html.js (JS enabled, motion allowed) */
html.js .reveal{opacity:0;transform:translateY(14px);transition:opacity .6s ease,transform .6s ease}
html.js .reveal.in{opacity:1;transform:none}
#dbg{position:fixed;inset-inline:0;bottom:0;max-height:40vh;overflow:auto;background:#3a0d0d;color:#ffd9d9;font-size:.75rem;padding:.5rem;display:none;z-index:99;direction:ltr}
@media(max-width:560px){.search{flex-direction:column}.hero h1{font-size:1.5rem}}
</style>
</head>
<body>
<div id="dbg" aria-hidden="true"></div>
<header>
  <div class="brand">🎵 ${E(s.title)}</div>
  <div>
    <a class="btn ghost" href="?lang=${lang === "fa" ? "en" : "fa"}" style="text-decoration:none">${E(s.langSwitch)}</a>
    <button class="burger" id="burger" aria-label="menu" aria-expanded="false">☰</button>
  </div>
</header>
<nav id="nav">
  <a href="#how">${E(s.howTitle)}</a>
  <a href="#api">${E(s.apiTitle)}</a>
  <a href="#faq">${E(s.faqTitle)}</a>
  <a href="#terms">${E(s.termsTitle)}</a>
</nav>

<div class="wrap">
  <div class="hero reveal">
    <h1>${E(s.title)}</h1>
    <p>${E(s.tagline)}</p>
    <form class="search" id="sform" action="/api/v1/search" method="get">
      <input type="search" name="q" placeholder="${E(s.searchPlaceholder)}" required autocomplete="off" id="q">
      <select name="source" id="src">
        <option value="all">${E(s.sourceAll)}</option>
        <option value="deezer">Deezer</option>
        <option value="itunes">iTunes</option>
        <option value="openverse">Openverse</option>
        <option value="archive">Internet Archive</option>
        <option value="jamendo">Jamendo</option>
        <option value="soundcloud">SoundCloud</option>
      </select>
      <button class="btn" type="submit">${E(s.searchBtn)}</button>
    </form>
    <p class="note">${E(s.iranNote)}</p>
  </div>

  <div id="results" aria-live="polite"></div>

  <section id="how" class="reveal">
    <h2>${E(s.howTitle)}</h2>
    <p>${E(s.howBody)}</p>
  </section>

  <section id="api" class="reveal">
    <h2>${E(s.apiTitle)}</h2>
    <pre>GET /api/v1/search?q=QUERY&amp;source=all&amp;page=1&amp;lang=fa
GET /api/v1/track?id=dz_123
GET /api/v1/download?id=ia_abc&amp;index=0
GET /api/v1/stream?url=...
GET /api/v1/cover?url=...
GET /health  ·  GET /openapi.json</pre>
    <pre>curl "https://&lt;host&gt;/api/v1/search?q=daft%20punk"
fetch('/api/v1/search?q=test').then(r=>r.json())
import requests; requests.get(base+'/api/v1/search',params={'q':'test'})</pre>
    <h3>${E(s.errTableTitle)}</h3>
    <table><thead><tr><th>${E(s.code)}</th><th>${E(s.meaning)}</th></tr></thead><tbody>${errRows}</tbody></table>
  </section>

  <section id="faq" class="reveal">
    <h2>${E(s.faqTitle)}</h2>
    ${faq}
  </section>

  <section id="terms" class="reveal">
    <h2>${E(s.termsTitle)}</h2>
    <p>${E(s.termsBody)}</p>
  </section>
</div>

<footer>
  ${E(s.footer)} · <a href="https://t.me/AliMsvD" rel="noopener">t.me/AliMsvD</a>
</footer>

<script nonce="${nonce}">
(function(){
"use strict";
var L=${JSON.stringify(lang)};
var T={loading:${JSON.stringify(s.loading)},noResults:${JSON.stringify(s.noResults)},
  errorNet:${JSON.stringify(s.errorNet)},preview:${JSON.stringify(s.preview)},
  download:${JSON.stringify(s.download)},openSource:${JSON.stringify(s.openSource)},
  duration:${JSON.stringify(s.duration)},license:${JSON.stringify(s.license)},
  source:${JSON.stringify(s.source)}};
function show(m){try{var d=document.getElementById('dbg');if(location.search.indexOf('debug=1')>-1){d.style.display='block';d.textContent+=m+'\n';}}catch(e){}}
window.addEventListener('error',function(e){show('ERR: '+e.message+' @'+e.filename+':'+e.lineno);});
try{
  var burger=document.getElementById('burger'),nav=document.getElementById('nav');
  if(burger)burger.addEventListener('click',function(){nav.classList.toggle('open');burger.setAttribute('aria-expanded',nav.classList.contains('open'));});
}catch(e){show(e.message)}
try{
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target);}});},{threshold:.1});
    document.querySelectorAll('.reveal').forEach(function(n){io.observe(n);});
  } else {document.querySelectorAll('.reveal').forEach(function(n){n.classList.add('in');});}
}catch(e){show(e.message)}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
function card(t){
  var b='';b+='<div class="card">'+(t.cover?'<img loading="lazy" src="/api/v1/cover?url='+encodeURIComponent(t.cover)+'" alt="">':'');
  b+='<div class="b"><div class="t">'+esc(t.title)+'</div><div class="a">'+esc(t.artist)+'</div>';
  b+='<div class="badges"><span class="badge">'+esc(t.source)+'</span>';
  if(t.duration)b+='<span class="badge">'+t.duration+'</span>';
  if(t.license)b+='<span class="badge">'+esc(t.license)+'</span>';
  b+='</div><div class="actions">';
  if(t.preview_url)b+='<button class="btn ghost" data-p="'+encodeURIComponent(t.preview_url)+'">'+T.preview+'</button>';
  if(t.downloadable&&t.download)b+='<a class="btn" style="background:var(--acc);color:#fff;border:none" href="'+t.download+'">'+T.download+'</a>';
  else if(t.page_url)b+='<a href="'+t.page_url+'" target="_blank" rel="noopener">'+T.openSource+'</a>';
  b+='</div></div></div>';return b;
}
try{
  var form=document.getElementById('sform'),out=document.getElementById('results');
  form.addEventListener('submit',function(ev){
    ev.preventDefault();
    var q=document.getElementById('q').value.trim();if(!q)return;
    var src=document.getElementById('src').value;
    out.innerHTML='<p>'+T.loading+'</p>';
    fetch('/api/v1/search?q='+encodeURIComponent(q)+'&source='+src+'&lang='+L)
    .then(function(r){return r.json();}).then(function(d){
      if(!d.results||!d.results.length){out.innerHTML='<p>'+T.noResults+'</p>';return;}
      var h='<div class="grid">'+d.results.map(card).join('')+'</div>';out.innerHTML=h;
    }).catch(function(e){out.innerHTML='<p>'+T.errorNet+'</p>';show(e.message);});
  });
  out.addEventListener('click',function(e){
    var b=e.target.closest('[data-p]');if(!b)return;
    var url=decodeURIComponent(b.getAttribute('data-p'));
    var a=b.parentElement.querySelector('audio');
    if(a){a.paused?a.play():a.pause();return;}
    a=document.createElement('audio');a.controls=true;a.preload='none';
    a.src='/api/v1/stream?url='+encodeURIComponent(url);b.parentElement.appendChild(a);a.play();
  });
}catch(e){show(e.message)}
})();
</script>
</body>
</html>`;
}
