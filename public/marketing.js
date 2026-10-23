/* Sipwise marketing site: the small bit of script behind the public pages. No framework, no dependencies.
   Markup and charts come from the server; this adds the calculator, the encryption demo, the scroll story, the
   language and video switches, and the tilt and count-up motion. Everything on the page is readable without it.
   The maths below mirrors lib/marketing-math.ts (tests/marketing.test.mjs checks they give identical output). */
(function () {
  'use strict';

  /* ---------- maths (also used by the tests, which run this file without a DOM) ---------- */
  function group(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function rs(n) { return 'Rs ' + group(n); }
  function rsShort(n) {
    if (n >= 1e7) return 'Rs ' + (n / 1e7).toFixed(2) + ' crore';
    if (n >= 1e5) return 'Rs ' + (n / 1e5).toFixed(1) + ' lakh';
    return rs(n);
  }
  function axisLabel(n) {
    if (n >= 1e7) return (n / 1e7).toFixed(1) + ' cr';
    if (n >= 1e5) return Math.round(n / 1e5) + ' lakh';
    return Math.round(n / 1e3) + 'k';
  }
  function f1(n) { return n.toFixed(1); }

  /* Same month-by-month loop as lib/sip-blueprint.ts#projectScenario with no levers. */
  function projectCalc(i) {
    const r = Math.pow(1 + i.annualPct / 100, 1 / 12) - 1;
    let value = 0;
    let invested = 0;
    const points = [];
    for (let y = 0; y < i.years; y++) {
      const raised = i.monthly * Math.pow(1 + i.stepUpPct / 100, y);
      for (let mo = 0; mo < 12; mo++) { value = (value + raised) * (1 + r); invested += raised; }
      points.push({ year: y + 1, value: value, invested: invested });
    }
    return { points: points, lastMonthly: i.monthly * Math.pow(1 + i.stepUpPct / 100, Math.max(0, i.years - 1)) };
  }

  const W = 640, H = 280, PL = 8, PR = 74, PB = 26, PT = 12;
  function calcView(i) {
    const p = projectCalc(i), pts = p.points, end = pts[pts.length - 1];
    const max = end.value * 1.05, n = pts.length, bw = (W - PL - PR) / n;
    function y(v) { return PT + (1 - v / max) * (H - PT - PB); }
    let grid = '', g;
    for (g = 0; g <= 3; g++) {
      const v = max * g / 3, gy = y(v);
      grid += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + f1(gy) + '" y2="' + f1(gy) + '" stroke="#202B4B" stroke-dasharray="2 4"/><text x="' + (W - PR + 8) + '" y="' + f1(gy + 4) + '" fill="#95A2BF" font-family="monospace" font-size="11">' + axisLabel(v) + '</text>';
    }
    let bars = '', line = '', step = '';
    pts.forEach(function (d, k) {
      const x0 = PL + k * bw + bw * 0.14, w = bw * 0.72;
      bars += '<rect x="' + f1(x0) + '" y="' + f1(y(d.value)) + '" width="' + f1(w) + '" height="' + f1(H - PB - y(d.value)) + '" rx="' + f1(Math.min(4, w / 3)) + '" fill="url(#mk-area-b)"/>';
      step += k ? 'H' + f1(PL + k * bw) + 'V' + f1(y(d.invested)) : 'M' + PL + ' ' + f1(y(d.invested));
      line += (k ? 'L' : 'M') + f1(PL + k * bw + bw / 2) + ' ' + f1(y(d.value));
    });
    step += 'H' + f1(W - PR);
    const lx = PL + (n - 0.5) * bw, ly = y(end.value);
    const marks = [1, Math.ceil(n / 2), n].filter(function (v, k, a) { return a.indexOf(v) === k; }).map(function (yy) {
      return '<text x="' + f1(PL + (yy - 0.5) * bw) + '" y="' + (H - 6) + '" text-anchor="middle" fill="#95A2BF" font-family="monospace" font-size="11">Yr ' + yy + '</text>';
    }).join('');
    const svg = grid + bars +
      '<path d="' + step + '" fill="none" stroke="#95A2BF" stroke-width="1.6" stroke-dasharray="4 4"/>' +
      '<path d="' + line + '" fill="none" stroke="#2EE6A6" stroke-width="2.6" stroke-linejoin="round"/>' +
      '<circle cx="' + f1(lx) + '" cy="' + f1(ly) + '" r="10" fill="#2EE6A6" opacity=".2"/><circle cx="' + f1(lx) + '" cy="' + f1(ly) + '" r="4.5" fill="#2EE6A6"/>' +
      marks +
      '<g font-family="sans-serif" font-size="11" fill="#95A2BF"><line x1="' + (PL + 4) + '" x2="' + (PL + 22) + '" y1="' + (PT + 8) + '" y2="' + (PT + 8) + '" stroke="#95A2BF" stroke-dasharray="4 4"/><text x="' + (PL + 28) + '" y="' + (PT + 12) + '">Money you put in</text><line x1="' + (PL + 140) + '" x2="' + (PL + 158) + '" y1="' + (PT + 8) + '" y2="' + (PT + 8) + '" stroke="#2EE6A6" stroke-width="2.4"/><text x="' + (PL + 164) + '" y="' + (PT + 12) + '">Value</text></g>';
    return { invested: rsShort(end.invested), value: rsShort(end.value), last: rs(p.lastMonthly), svg: svg };
  }

  if (typeof document === 'undefined') { globalThis.sipwiseMarketing = { calcView: calcView, projectCalc: projectCalc, group: group }; return; }

  /* ---------- helpers ---------- */
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = $('.mk');
  if (!root) return;

  /* ---------- usage events (same catalog as the app: lib/analytics-events.ts) ---------- */
  function optedOut() { try { return localStorage.getItem('sipwise.analytics.optout') === '1'; } catch { return false; } }
  function send(events) {
    if (optedOut()) return;
    let sid;
    try { sid = sessionStorage.getItem('sipwise.analytics.session'); if (!sid) { sid = crypto.randomUUID(); sessionStorage.setItem('sipwise.analytics.session', sid); } } catch { sid = String(Math.random()).slice(2); }
    let anon;
    try { anon = localStorage.getItem('sipwise.analytics.anon'); if (!anon) { anon = crypto.randomUUID(); localStorage.setItem('sipwise.analytics.anon', anon); } } catch { anon = undefined; }
    try { fetch('/api/events', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid, anonId: anon, platform: 'web', events: events }) }).catch(function () {}); } catch { /* analytics must never get in the way */ }
  }
  if (root.getAttribute('data-page') === 'home') send([{ event: 'landing_viewed', props: {} }, { event: 'screen_viewed', props: { screen: 'landing' } }]);
  document.addEventListener('click', function (e) {
    const a = e.target && e.target.closest ? e.target.closest('a[href*="/api/auth/google/login"]') : null;
    if (a) send([{ event: 'sign_in_clicked', props: {} }]);
  });

  /* ---------- nav ---------- */
  const nav = $('.m-nav');
  function onScroll() { if (nav) nav.classList.toggle('m-solid', window.scrollY > 20); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const sheet = $('#mk-sheet'), menuBtn = $('#mk-menu');
  function setSheet(open) { if (!sheet || !menuBtn) return; sheet.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); document.documentElement.style.overflow = open ? 'hidden' : ''; if (open) { const c = $('.m-close', sheet); if (c) c.focus(); } else menuBtn.focus(); }
  if (menuBtn) menuBtn.addEventListener('click', function () { setSheet(true); });
  if (sheet) {
    $('.m-close', sheet).addEventListener('click', function () { setSheet(false); });
    sheet.addEventListener('click', function (e) { if (e.target.closest('a')) { setSheet(false); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) setSheet(false); });
  }
  document.addEventListener('click', function (e) {
    const a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    const el = document.getElementById(a.getAttribute('href').slice(1));
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    try { history.replaceState(null, '', a.getAttribute('href')); } catch { /* ignore */ }
  });

  /* ---------- hero: count-up, line draw, tilt ---------- */
  const nw = $('#mk-nw');
  if (nw && !reduce) {
    const endV = +nw.getAttribute('data-end'), t0 = performance.now();
    (function tick(t) { const k = Math.min(1, (t - t0) / 1600); nw.textContent = group(endV * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); })(t0);
  }
  if (!reduce) $$('[data-draw] .m-ln').forEach(function (ln) {
    const L = ln.getTotalLength(); ln.style.strokeDasharray = L; ln.style.strokeDashoffset = L; ln.getBoundingClientRect();
    ln.style.transition = 'stroke-dashoffset 1.8s cubic-bezier(.6,0,.2,1)'; ln.style.strokeDashoffset = 0;
  });
  const stage = $('#mk-stage'), slab = $('#mk-slab');
  if (stage && slab && !reduce && window.matchMedia('(pointer:fine)').matches) {
    stage.addEventListener('pointermove', function (e) {
      const r = stage.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      slab.style.transform = 'rotateY(' + (-14 + px * 16) + 'deg) rotateX(' + (8 - py * 12) + 'deg)';
      slab.style.setProperty('--mx', (px + 0.5) * 100 + '%'); slab.style.setProperty('--my', (py + 0.5) * 100 + '%');
    });
    stage.addEventListener('pointerleave', function () { slab.style.transform = ''; });
  }

  /* hero language switch: English or Urdu words, the rest of the page stays English */
  const langBtns = $$('.m-lang button');
  langBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      const ur = b.getAttribute('data-lang') === 'ur';
      langBtns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      $$('[data-en]').forEach(function (el) {
        el.innerHTML = ur ? el.getAttribute('data-ur') : el.getAttribute('data-en');
        el.dir = ur ? 'rtl' : 'ltr'; el.lang = ur ? 'ur' : 'en'; el.classList.toggle('m-is-ur', ur);
      });
      const vl = ur ? 'ur' : 'en';
      const vb = $('[data-vlang="' + vl + '"]'); if (vb) vb.click();
    });
  });

  /* ---------- tile spotlight ---------- */
  $$('.m-tile').forEach(function (t) { t.addEventListener('pointermove', function (e) { const r = t.getBoundingClientRect(); t.style.setProperty('--sx', e.clientX - r.left + 'px'); t.style.setProperty('--sy', e.clientY - r.top + 'px'); }); });

  /* ---------- scroll story ---------- */
  const steps = $$('.m-sstep'), scenes = $$('.m-scene');
  if (steps.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        const i = +en.target.getAttribute('data-step');
        steps.forEach(function (s) { s.classList.toggle('m-on', s === en.target); });
        scenes.forEach(function (s) { s.classList.toggle('m-on', +s.getAttribute('data-scene') === i); });
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach(function (s) { io.observe(s); });
  }

  /* ---------- calculator ---------- */
  const cAmt = $('#cAmt');
  if (cAmt) {
    const cYrs = $('#cYrs'), cRet = $('#cRet'), cStep = $('#cStep');
    const draw = function () {
      const i = { monthly: +cAmt.value, years: +cYrs.value, annualPct: +cRet.value, stepUpPct: +cStep.value };
      $('#oAmt').textContent = rs(i.monthly); $('#hdAmt').textContent = group(i.monthly); $('#oYrs').textContent = i.years;
      $('#oRet').textContent = i.annualPct + '%'; $('#oStep').textContent = i.stepUpPct + '%';
      const v = calcView(i);
      $('#kIn').textContent = v.invested; $('#kOut').textContent = v.value; $('#kLast').textContent = v.last;
      $('#calcChart').innerHTML = v.svg;
    };
    [cAmt, cYrs, cRet, cStep].forEach(function (el) { el.addEventListener('input', draw); });
  }

  /* ---------- encryption demo (Web Crypto AES-256-GCM, a throwaway key that never leaves this page) ---------- */
  const plain = $('#mk-plain'), cipher = $('#mk-cipher');
  if (plain && cipher) {
    let key = null;
    const b64 = function (buf) { let s = ''; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); };
    const enc = function () {
      if (!window.crypto || !crypto.subtle) return;
      const getKey = key ? Promise.resolve(key) : crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']).then(function (k) { key = k; return k; });
      getKey.then(function (k) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(plain.value)).then(function (ct) { cipher.textContent = 'v3.aes-gcm.' + b64(iv) + '.' + b64(ct); });
      }).catch(function () { /* keeps the sample text */ });
    };
    plain.addEventListener('input', enc); enc();
  }

  /* ---------- video ---------- */
  const vid = $('#mk-vid');
  if (vid) {
    let vlang = 'ur', vshape = 'landscape';
    const setVideo = function () {
      const base = '/videos/sipwise-getting-started-' + (vlang === 'ur' ? 'urdu-' : '') + vshape;
      vid.poster = '/videos/poster-' + (vlang === 'ur' ? 'urdu-' : '') + vshape + '.jpg';
      vid.innerHTML = '<source src="' + base + '.mp4" type="video/mp4">' + (vlang === 'en' ? '<track kind="captions" src="/videos/sipwise-getting-started-' + vshape + '.vtt" srclang="en" label="English" default>' : '');
      vid.classList.toggle('m-portrait', vshape === 'portrait'); vid.load();
    };
    $$('[data-vlang]').forEach(function (b) { b.addEventListener('click', function () { if (vlang === b.getAttribute('data-vlang')) return; vlang = b.getAttribute('data-vlang'); $$('[data-vlang]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); setVideo(); }); });
    $$('[data-vshape]').forEach(function (b) { b.addEventListener('click', function () { vshape = b.getAttribute('data-vshape'); $$('[data-vshape]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); setVideo(); }); });
    $$('#mk-chapters button').forEach(function (b) { b.addEventListener('click', function () { vid.currentTime = +b.getAttribute('data-t'); const p = vid.play(); if (p && p.catch) p.catch(function () {}); }); });
    // On a phone start with the portrait cut. Waits until the page has finished loading so it never changes markup React is still hydrating.
    if (window.matchMedia('(max-width: 760px)').matches) {
      const phone = function () { setTimeout(function () { const pb = $('[data-vshape="portrait"]'); if (pb) pb.click(); }, 1200); };
      if (document.readyState === 'complete') phone(); else window.addEventListener('load', phone);
    }
  }

  /* ---------- logo draws once when it scrolls in ---------- */
  const fm = $('#mk-final-mark');
  if (fm && 'IntersectionObserver' in window) new IntersectionObserver(function (e, o) { if (e[0].isIntersecting) { fm.classList.add('m-draw'); o.disconnect(); } }).observe(fm);
  else if (fm) fm.classList.add('m-draw');
})();
