// Renders the daily "Market summary" video from recap.json (scripts/market-recap-data.mjs): five 1080x1920 slides in the
// Sipwise "after dark" look, one ElevenLabs voice-over clip per slide with a pause after each, joined with ffmpeg.
//
// Env: ELEVENLABS_API_KEY (skipped with --no-audio or when --voice-dir holds voice-N.mp3 already), ELEVENLABS_VOICE_ID, GEIST_DIR (folder holding the `geist` npm package).
// Usage: node scripts/market-recap-render.mjs --in=recap.json --out=recap-out [--no-audio] [--voice-dir=dir] [--only=1,2]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { audioSeconds, characterList, mouthTrack, renderSprites } from './market-recap-character.mjs';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const input = arg('in', 'recap.json');
const out = arg('out', 'recap-out');
const noAudio = process.argv.includes('--no-audio');
const voiceDir = arg('voice-dir', '');
const only = arg('only', '').split(',').filter(Boolean).map(Number);
const GAP_SECONDS = 1.2;
const W = 900;
const H = 330;

const b64 = async (file) => (await readFile(file)).toString('base64');
const num = (n, digits = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const mark = `<svg viewBox="0 0 32 32" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7db0ff"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#g)"/><path d="M6.5 23.5h5v-5h5v-5h5v-5h4" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="25.5" cy="8.5" r="2.4" fill="#22e0a0"/></svg>`;

const css = (sans, mono) => `
@font-face{font-family:G;src:url(data:font/woff2;base64,${sans});font-weight:100 900}
@font-face{font-family:GM;src:url(data:font/woff2;base64,${mono});font-weight:100 900}
*{box-sizing:border-box;margin:0}
body{width:1080px;height:1920px;font-family:G,sans-serif;color:#e8eefa;background:#070b18;position:relative;overflow:hidden}
.glow1{position:absolute;width:1100px;height:1100px;right:-450px;top:-300px;background:radial-gradient(closest-side,rgba(59,130,246,.38),transparent)}
.glow2{position:absolute;width:1000px;height:1000px;left:-450px;bottom:-250px;background:radial-gradient(closest-side,rgba(34,224,160,.2),transparent)}
.wrap{position:relative;padding:84px 72px 420px;height:100%;display:flex;flex-direction:column}
.wrap.end{padding-bottom:84px}
.foot{position:absolute;left:72px;bottom:84px;width:560px;flex-direction:column;gap:6px}
.brand{display:flex;align-items:center;gap:20px}.brand b{font-size:46px;font-weight:700;letter-spacing:-.02em}
.chip{margin-left:auto;padding:12px 24px;border-radius:99px;background:rgba(255,255,255,.08);color:#9fb0d6;font-size:28px;font-weight:500}
.eyebrow{margin-top:90px;color:#9fb0d6;font-size:34px;font-weight:500;letter-spacing:.04em;text-transform:uppercase}
h1{font-size:96px;font-weight:700;letter-spacing:-.035em;line-height:1.02;margin-top:18px}
.mono{font-family:GM,monospace;font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.card{background:#0d1428;border:2px solid #202b4b;border-radius:44px;padding:48px}
.slab{background:linear-gradient(160deg,#0e1a3f,#0a1230);border:2px solid rgba(255,255,255,.09);border-radius:52px;padding:56px;position:relative;overflow:hidden}
.pill{display:inline-flex;align-items:center;gap:12px;padding:14px 30px;border-radius:99px;font-size:44px;font-weight:600}
.up{color:#2ee6a6;background:rgba(46,230,166,.13)}.dn{color:#ff6f86;background:rgba(255,111,134,.13)}
.foot{display:flex;color:#6f7d9c;font-size:28px}
.fill{flex:1;margin:70px 0 40px;display:flex;flex-direction:column;justify-content:space-around}
.row{display:flex;align-items:center;gap:32px;padding:34px 0;border-top:2px solid rgba(255,255,255,.07)}.row:first-child{border-top:0}
.tile{width:112px;height:112px;border-radius:32px;display:grid;place-items:center;font-weight:700;font-size:34px;flex:none}
.nm{flex:1}.nm b{display:block;font-size:50px;font-weight:700;letter-spacing:-.02em}
.px{text-align:right}.px .mono{display:block;font-size:44px;color:#e8eefa;margin-bottom:10px}
.bar{height:14px;border-radius:7px;background:rgba(255,255,255,.07);margin-top:22px;overflow:hidden}.bar i{display:block;height:100%;border-radius:7px}
.stats{display:flex;gap:20px;margin-top:36px}.stats div{flex:1;background:rgba(255,255,255,.06);border-radius:28px;padding:26px 30px}.stats small{display:block;color:#9fb0d6;font-size:26px;margin-bottom:8px}.stats b{font-size:42px;font-weight:600}
`;

const initials = (name) => name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const TINT_UP = ['rgba(91,141,239,.2);color:#8fb7ff', 'rgba(155,123,240,.2);color:#c0a8ff', 'rgba(43,181,140,.2);color:#6be0bb'];
const TINT_DN = ['rgba(224,138,46,.2);color:#f2b36a', 'rgba(232,116,59,.2);color:#ff9d70', 'rgba(224,82,143,.2);color:#ff8cbc'];

function movers(list, up) {
  const top = Math.max(6, ...list.map((m) => Math.abs(m.changePercent)));
  const tint = up ? TINT_UP : TINT_DN;
  return list
    .map(
      (m, i) => `<div class="row"><div class="tile" style="background:${tint[i % 3]}">${esc(initials(m.name))}</div><div class="nm"><b>${esc(m.name)}</b><div class="bar"><i style="width:${(Math.abs(m.changePercent) / top) * 100}%;background:${up ? '#2ee6a6' : '#ff6f86'}"></i></div></div><div class="px"><span class="mono">Rs ${num(m.price, 1)}</span><span class="pill ${up ? 'up' : 'dn'} mono">${m.changePercent > 0 ? '+' : '−'}${Math.abs(m.changePercent).toFixed(1)}%</span></div></div>`,
    )
    .join('');
}

function chart(line, color) {
  if (line.length < 4) return '';
  const step = Math.max(1, Math.floor(line.length / 60));
  const pts = line.filter((_, i) => i % step === 0 || i === line.length - 1);
  const mn = Math.min(...pts);
  const mx = Math.max(...pts);
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * W, H - ((v - mn) / (mx - mn || 1)) * (H - 20) - 10]);
  const d = `M${xy.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L')}`;
  const [lx, ly] = xy.at(-1);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="margin-top:44px"><defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${d}L${W} ${H}L0 ${H}Z" fill="url(#a)"/><path d="${d}" fill="none" stroke="${color}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${lx}" cy="${ly}" r="12" fill="${color}"/></svg>`;
}

function slides(r) {
  const down = r.index.change < 0;
  const color = down ? '#ff6f86' : '#2ee6a6';
  const day = new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const shell = (inner, n) => `<div class="glow1"></div><div class="glow2"></div><div class="wrap${n === 5 ? ' end' : ''}"><div class="brand">${mark}<b>Sipwise</b><span class="chip">PSX · Market summary</span></div>${inner}<div class="foot"><span>${day} · sipwise.trade</span><span>${n}/5</span></div></div>`;
  const dividend = r.dividends[0];
  return [
    shell(
      `<div class="eyebrow">${new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })} close</div><h1>${down ? 'The market<br>gave a little back.' : 'The market<br>moved higher.'}</h1>
<div class="slab fill" style="justify-content:${(r.index.line ?? []).length > 3 ? 'space-between' : 'space-around'}"><div><div class="mono" style="color:#9fb0d6;font-size:34px;letter-spacing:0">KSE-100</div><div class="mono" style="font-size:150px;font-weight:600;margin:14px 0 26px">${num(r.index.close)}</div><span class="pill ${down ? 'dn' : 'up'} mono">${down ? '▼' : '▲'} ${num(Math.abs(r.index.change))} pts · ${down ? '−' : '+'}${Math.abs(r.index.changePercent).toFixed(2)}%</span>${chart(r.index.line ?? [], color)}</div>
<div class="stats"><div><small>High</small><b class="mono">${num(r.index.high)}</b></div><div><small>Low</small><b class="mono">${num(r.index.low)}</b></div><div><small>Volume</small><b class="mono">${num(r.index.volume / 1e6)}M</b></div></div></div>`,
      1,
    ),
    shell(`<div class="eyebrow">Top gainers</div><h1>Today's biggest<br>risers.</h1><div class="card fill">${movers(r.gainers, true)}</div>`, 2),
    shell(`<div class="eyebrow">Top losers</div><h1>Today's biggest<br>fallers.</h1><div class="card fill">${movers(r.losers, false)}</div>`, 3),
    shell(
      `<div class="eyebrow">${dividend ? 'Dividend news' : 'Most traded'}</div><h1>${dividend ? 'A new cash<br>dividend today.' : 'Where the<br>action was.'}</h1>${
        dividend
          ? `<div class="slab" style="margin-top:70px;padding:72px 56px"><div style="display:flex;align-items:center;gap:32px"><div class="tile" style="background:rgba(91,141,239,.2);color:#8fb7ff">${esc(initials(dividend.name))}</div><div class="nm"><b style="font-size:56px">${esc(dividend.name)}</b></div></div><div class="mono" style="font-size:140px;font-weight:600;margin-top:44px;color:#2ee6a6">${num(dividend.percent)}%</div><div style="font-size:40px;color:#9fb0d6;margin-top:6px">cash dividend announced</div></div>`
          : ''
      }${
        dividend
          ? `<div class="card" style="margin-top:36px;margin-bottom:40px"><div style="color:#9fb0d6;font-size:30px;margin-bottom:24px">Most traded today</div><div style="display:flex;gap:20px">${r.active.map((m) => `<span style="flex:1;text-align:center;background:rgba(255,255,255,.06);border-radius:28px;padding:30px 12px;font-size:34px;font-weight:600;line-height:1.2">${esc(m.name)}</span>`).join('')}</div></div>`
          : `<div class="card fill">${r.active.map((m, i) => `<div class="row"><div class="tile" style="background:${TINT_UP[i % 3]}">${esc(initials(m.name))}</div><div class="nm"><b>${esc(m.name)}</b></div></div>`).join('')}</div>`
      }`,
      4,
    ),
    shell(
      `<div style="margin:auto 0;text-align:center"><div style="display:flex;justify-content:center;transform:scale(2.2);margin-bottom:130px">${mark}</div><h1 style="font-size:104px">Invest monthly.<br>See everything.<br><span style="color:#2ee6a6">Share nothing.</span></h1><div style="margin-top:90px;display:inline-block;padding:36px 80px;border-radius:99px;background:linear-gradient(135deg,#4c8dff,#1d4ed8);font-size:56px;font-weight:600;box-shadow:0 24px 60px -16px rgba(76,141,255,.7)">sipwise.trade</div><div style="margin-top:44px;font-size:34px;color:#9fb0d6">Free monthly SIP planner for PSX investors</div><div style="margin-top:36px;display:inline-block;padding:22px 52px;border-radius:99px;border:3px solid #2ee6a6;color:#2ee6a6;font-size:42px;font-weight:600">Subscribe for daily market updates</div></div>`,
      5,
    ),
  ];
}

async function speak(text, file) {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) throw Error('ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are required (or pass --no-audio).');
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.75, similarity_boost: 0.8, speed: 0.9 } }),
  });
  if (!response.ok) throw Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 200)}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
}

const recap = JSON.parse(await readFile(input, 'utf8'));
await mkdir(out, { recursive: true });
const geist = process.env.GEIST_DIR ?? 'package';
const sans = await b64(`${geist}/dist/fonts/geist-sans/Geist-Variable.woff2`);
const mono = await b64(`${geist}/dist/fonts/geist-mono/GeistMono-Variable.woff2`);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
const html = slides(recap);
for (let i = 0; i < html.length; i++) {
  await page.setContent(`<html><head><style>${css(sans, mono)}</style></head><body>${html[i]}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}/slide-${i + 1}.png` });
}
const spriteDir = `${process.cwd()}/${out}/sprites`;
await mkdir(spriteDir, { recursive: true });
await renderSprites(page, spriteDir);
await browser.close();
if (noAudio) process.exit(0);

const clips = [];
for (let i = 0; i < html.length; i++) {
  if (only.length && !only.includes(i + 1)) continue;
  const voiceFile = voiceDir ? `${voiceDir}/voice-${i + 1}.mp3` : `${out}/voice-${i + 1}.mp3`;
  if (!voiceDir) await speak(recap.spoken[i], voiceFile);
  // The slide lasts as long as its voice-over plus the breathing gap; Sip talks through the first part.
  const seconds = audioSeconds(voiceFile) + GAP_SECONDS;
  await writeFile(`${out}/sip-${i + 1}.txt`, characterList(mouthTrack(voiceFile), seconds, spriteDir));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', '30', '-i', `${out}/slide-${i + 1}.png`,
    '-f', 'concat', '-safe', '0', '-i', `${out}/sip-${i + 1}.txt`, '-i', voiceFile,
    '-filter_complex', `[1:v]fps=30,scale=iw*0.8:-1,format=rgba[sip];[0:v][sip]overlay=x=W-w-40:y='H-h-60+7*sin(2*PI*t*1.1)':shortest=1,format=yuv420p[v];[2:a]apad=pad_dur=${GAP_SECONDS}[a]`,
    '-map', '[v]', '-map', '[a]', '-t', seconds.toFixed(2), '-c:v', 'libx264', '-r', '30', '-c:a', 'aac', '-b:a', '160k', `${out}/part-${i + 1}.mp4`]);
  clips.push(`file part-${i + 1}.mp4`);
}
await writeFile(`${out}/list.txt`, clips.join('\n'));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${out}/list.txt`, '-c', 'copy', `${out}/recap.mp4`]);
console.log(`Rendered ${out}/recap.mp4`);
