// Renders one daytime education short (Urdu voice-over, English words kept) from scripts/social-tips-episodes.json:
// four content slides plus a closing slide, 1080x1920 in the Sipwise "after dark" look, with Sip talking, joined with ffmpeg.
// Same pipeline as the daily market recap (scripts/market-recap-render.mjs).
//
// Env: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, GEIST_DIR (folder holding the `geist` npm package).
// Usage: node scripts/social-tips-render.mjs [--episode=sip-basics | --date=2026-10-28] --out=tips-out [--no-audio]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spaceBackground, sipDataUrl, SIP_RATIO } from './social-brand.mjs';
import { execFileSync } from 'node:child_process';
import { audioSeconds, characterList, mouthTrack, renderSprites } from './market-recap-character.mjs';

const GAP_SECONDS = 1.0;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const multiline = (s) => esc(s).replace(/\n/g, '<br>');

const mark = `<svg viewBox="0 0 32 32" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7db0ff"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#g)"/><path d="M6.5 23.5h5v-5h5v-5h5v-5h4" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="25.5" cy="8.5" r="2.4" fill="#22e0a0"/></svg>`;

const css = (sans, mono) => `
@font-face{font-family:G;src:url(data:font/woff2;base64,${sans});font-weight:100 900}
@font-face{font-family:GM;src:url(data:font/woff2;base64,${mono});font-weight:100 900}
*{box-sizing:border-box;margin:0}
body{width:1080px;height:1920px;font-family:G,sans-serif;color:#e8eefa;background:${spaceBackground};position:relative;overflow:hidden}
.glow1{display:none;position:absolute;width:1100px;height:1100px;right:-450px;top:-300px;background:radial-gradient(closest-side,rgba(59,130,246,.38),transparent)}
.glow2{display:none;position:absolute;width:1000px;height:1000px;left:-450px;bottom:-250px;background:radial-gradient(closest-side,rgba(34,224,160,.2),transparent)}
.wrap{position:relative;padding:84px 72px 420px;height:100%;display:flex;flex-direction:column}
.wrap.end{padding-bottom:84px}
.brand{display:flex;align-items:center;gap:20px}.brand b{font-size:46px;font-weight:700;letter-spacing:-.02em}
.chip{margin-left:auto;padding:12px 24px;border-radius:99px;background:rgba(255,255,255,.08);color:#9fb0d6;font-size:28px;font-weight:500}
.eyebrow{margin-top:90px;color:#9fb0d6;font-size:34px;font-weight:500;letter-spacing:.04em;text-transform:uppercase}
h1{font-size:100px;font-weight:700;letter-spacing:-.035em;line-height:1.04;margin-top:18px}
.mono{font-family:GM,monospace;font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.slab{background:linear-gradient(160deg,#0e1a3f,#0a1230);border:2px solid rgba(255,255,255,.09);border-radius:52px;padding:56px;margin-top:56px}
.big{font-size:150px;font-weight:600;color:#2ee6a6;line-height:1}
.note{margin-top:20px;font-size:38px;color:#9fb0d6;line-height:1.3}
.line{padding:30px 0;border-top:2px solid rgba(255,255,255,.07);font-size:46px;font-weight:600}.line:first-child{border-top:0;padding-top:0}
.cardpt{display:flex;gap:26px;align-items:flex-start;background:#0d1428;border:2px solid #202b4b;border-radius:36px;padding:28px 34px}.cardpt>span{color:#2ee6a6;font-size:46px;font-weight:600}.cardpt b{display:block;font-size:40px;line-height:1.15}.cardpt small{display:block;margin-top:8px;color:#9fb0d6;font-size:28px;line-height:1.3}
.foot{margin-top:auto;display:flex;justify-content:space-between;color:#6f7d9c;font-size:28px}
`;

function slides(ep, riskLine) {
  const frame = (inner, n, total, end = false) =>
    `<div class="glow1"></div><div class="glow2"></div><div class="wrap${end ? ' end' : ''}"><div class="brand">${mark}<b>Sipwise</b><span class="chip">${esc(ep.topic)}</span></div>${inner}<div class="foot"><span>sipwise.trade</span><span>${n}/${total}</span></div></div>`;
  const total = ep.slides.length + 1;
  const content = ep.slides.map((s, i) => {
    const box = s.big || s.lines
      ? `<div class="slab">${s.big ? `<div class="mono big">${esc(s.big)}</div>` : ''}${s.lines ? s.lines.map((l) => `<div class="line">${esc(l)}</div>`).join('') : ''}${s.note && s.big ? `<div class="note">${esc(s.note)}</div>` : ''}</div>`
      : '';
    const note = s.note && !s.big ? `<div class="note" style="margin-top:56px">${esc(s.note)}</div>` : '';
    return frame(`<div style="flex:1;display:flex;flex-direction:column;justify-content:center;margin-top:-120px"><div class="eyebrow" style="margin-top:0">${esc(s.kicker)}</div><h1>${multiline(s.title)}</h1>${box}${note}</div>`, i + 1, total);
  });
  const closing = frame(
    `<div style="margin:auto 0;text-align:center"><div style="display:flex;justify-content:center;margin-bottom:56px"><img src="${sipDataUrl}" style="height:400px;width:${Math.round(400 * SIP_RATIO)}px"></div><h1 style="font-size:104px">Invest monthly.<br>See everything.<br><span style="color:#2ee6a6">Share nothing.</span></h1><div style="margin-top:90px;display:inline-block;padding:36px 80px;border-radius:99px;background:linear-gradient(135deg,#4c8dff,#1d4ed8);font-size:56px;font-weight:600">sipwise.trade</div><div style="margin-top:44px;display:inline-block;padding:22px 52px;border-radius:99px;border:3px solid #2ee6a6;color:#2ee6a6;font-size:42px;font-weight:600">Subscribe for daily tips</div><div style="margin-top:44px;font-size:28px;color:#6f7d9c">${esc(riskLine)}</div></div>`,
    total, total, true,
  );
  return [...content, closing];
}

/** One 1080x1350 picture with the whole tip (title and key points) for X and other photo posts. */
function card(ep, riskLine) {
  const points = ep.slides
    .map((s, i) => `<div class="cardpt"><span class="mono">${i + 1}</span><div><b>${esc(s.title.replace(/\n/g, ' '))}</b>${s.lines ? `<small>${esc(s.lines.join(' · '))}</small>` : s.big ? `<small>${esc(`${s.big}${s.note ? `: ${s.note}` : ''}`)}</small>` : s.note ? `<small>${esc(s.note)}</small>` : ''}</div></div>`)
    .join('');
  return `<div class="glow1"></div><div class="glow2"></div><div style="position:relative;padding:64px;height:100%;display:flex;flex-direction:column"><div class="brand">${mark}<b>Sipwise</b><span class="chip">Daily tip</span></div><h1 style="font-size:84px;margin-top:56px">${esc(ep.topic)}</h1><div style="margin-top:40px;display:flex;flex-direction:column;gap:22px">${points}</div><div style="margin-top:auto;display:flex;justify-content:space-between;align-items:center;color:#9fb0d6;font-size:26px"><span>${esc(riskLine)}</span><b style="color:#fff;font-size:34px">sipwise.trade</b></div></div>`;
}

/** The episode for a date: one per day from `start`, cycling through the list. */
export function pickEpisode(config, date) {
  const days = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${config.start}T00:00:00Z`)) / 86400000);
  const n = config.episodes.length;
  return config.episodes[((days % n) + n) % n];
}

export const captionFor = (ep, riskLine) => `${ep.caption}\n\nSubscribe for daily tips. Plan your monthly investing free: link in bio.\n${riskLine}`;

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

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const out = arg('out', 'tips-out');
  const noAudio = process.argv.includes('--no-audio');
  const config = JSON.parse(await readFile(new URL('./social-tips-episodes.json', import.meta.url), 'utf8'));
  const id = arg('episode', '');
  const date = arg('date', new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10));
  const ep = id ? config.episodes.find((e) => e.id === id) : pickEpisode(config, date);
  if (!ep) throw Error(`Unknown episode ${id}`);
  await mkdir(out, { recursive: true });
  await writeFile(`${out}/episode.json`, JSON.stringify({ id: ep.id, date, caption: captionFor(ep, config.riskLine) }, null, 2));

  const { chromium } = await import('playwright-core');
  const geist = process.env.GEIST_DIR ?? 'package';
  const sans = (await readFile(`${geist}/dist/fonts/geist-sans/Geist-Variable.woff2`)).toString('base64');
  const mono = (await readFile(`${geist}/dist/fonts/geist-mono/GeistMono-Variable.woff2`)).toString('base64');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const html = slides(ep, config.riskLine);
  for (let i = 0; i < html.length; i++) {
    await page.setContent(`<html><head><style>${css(sans, mono)}</style></head><body>${html[i]}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${out}/slide-${i + 1}.png` });
  }
  await page.setViewportSize({ width: 1080, height: 1350 });
  await page.setContent(`<html><head><style>${css(sans, mono)} body{height:1350px}</style></head><body>${card(ep, config.riskLine)}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}/card.jpg`, type: 'jpeg', quality: 92 });
  await page.setViewportSize({ width: 1080, height: 1920 });
  const spriteDir = `${process.cwd()}/${out}/sprites`;
  await mkdir(spriteDir, { recursive: true });
  await renderSprites(page, spriteDir);
  await browser.close();
  if (noAudio) process.exit(0);

  const clips = [];
  for (let i = 0; i < html.length; i++) {
    const voiceFile = `${out}/voice-${i + 1}.mp3`;
    await speak(ep.spoken[i], voiceFile);
    const seconds = audioSeconds(voiceFile) + GAP_SECONDS;
    await writeFile(`${out}/sip-${i + 1}.txt`, characterList(mouthTrack(voiceFile), seconds, spriteDir));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', '30', '-i', `${out}/slide-${i + 1}.png`,
      '-f', 'concat', '-safe', '0', '-i', `${out}/sip-${i + 1}.txt`, '-i', voiceFile,
      '-filter_complex', `[1:v]fps=30,scale=iw*0.8:-1,format=rgba[sip];[0:v][sip]overlay=x=W-w-40:y='H-h-60+7*sin(2*PI*t*1.1)':shortest=1,format=yuv420p[v];[2:a]apad=pad_dur=${GAP_SECONDS}[a]`,
      '-map', '[v]', '-map', '[a]', '-t', seconds.toFixed(2), '-c:v', 'libx264', '-r', '30', '-c:a', 'aac', '-b:a', '160k', `${out}/part-${i + 1}.mp4`]);
    clips.push(`file part-${i + 1}.mp4`);
  }
  await writeFile(`${out}/list.txt`, clips.join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${out}/list.txt`, '-c', 'copy', `${out}/tip.mp4`]);
  console.log(`Rendered ${out}/tip.mp4 (${ep.id})`);
}
