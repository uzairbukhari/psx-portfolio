// "Sip", the animated Sipwise character for the daily market recap video: a friendly version of the app icon whose
// mouth follows the voice-over and who blinks now and then. Pure drawing and audio maths; the renderer composes it.
import { execFileSync } from 'node:child_process';

export const FPS = 15;
export const SPRITE = { width: 340, height: 420 };

const eyesOpen = `<circle cx="112" cy="142" r="25" fill="#fff"/><circle cx="188" cy="142" r="25" fill="#fff"/><circle cx="116" cy="146" r="12" fill="#0b1430"/><circle cx="192" cy="146" r="12" fill="#0b1430"/><circle cx="121" cy="141" r="4" fill="#fff"/><circle cx="197" cy="141" r="4" fill="#fff"/>`;
const eyesShut = `<path d="M88 146 Q112 162 136 146" fill="none" stroke="#0b1430" stroke-width="7" stroke-linecap="round"/><path d="M164 146 Q188 162 212 146" fill="none" stroke="#0b1430" stroke-width="7" stroke-linecap="round"/>`;
// Mouth shapes, closed to wide open.
const mouths = [
  `<path d="M124 196 Q150 214 176 196" fill="none" stroke="#0b1430" stroke-width="7" stroke-linecap="round"/>`,
  `<ellipse cx="150" cy="200" rx="20" ry="8" fill="#0b1430"/>`,
  `<ellipse cx="150" cy="202" rx="24" ry="15" fill="#0b1430"/><ellipse cx="150" cy="210" rx="13" ry="6" fill="#ff7a90"/>`,
  `<ellipse cx="150" cy="206" rx="28" ry="24" fill="#0b1430"/><ellipse cx="150" cy="217" rx="16" ry="9" fill="#ff7a90"/>`,
];
export const MOUTH_LEVELS = mouths.length;

export function spriteHtml(mouth, blink) {
  return `<html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE.width}" height="${SPRITE.height}" viewBox="-20 0 340 420">
<defs><linearGradient id="head" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7db0ff"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs>
<ellipse cx="150" cy="404" rx="96" ry="12" fill="#000" opacity=".28"/>
<rect x="30" y="262" width="40" height="96" rx="20" fill="#16254f"/><rect x="230" y="262" width="40" height="96" rx="20" fill="#16254f"/>
<rect x="64" y="244" width="172" height="146" rx="46" fill="#0f1c42" stroke="#2a3d78" stroke-width="3"/>
<circle cx="150" cy="316" r="16" fill="#22e0a0"/><path d="M104 360h92" stroke="#2a3d78" stroke-width="6" stroke-linecap="round"/>
<rect x="36" y="14" width="228" height="226" rx="70" fill="url(#head)"/>
<path d="M108 82h18v-18h18v-18h18v-18h14" transform="translate(-6 8)" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/><circle cx="200" cy="30" r="9" fill="#22e0a0"/>
${blink ? eyesShut : eyesOpen}
<circle cx="84" cy="188" r="14" fill="#ff9db0" opacity=".45"/><circle cx="216" cy="188" r="14" fill="#ff9db0" opacity=".45"/>
${mouths[mouth]}
</svg></body></html>`;
}

/** Writes sprite-<mouth>-<blink>.png (transparent) for every mouth shape, eyes open and shut. */
export async function renderSprites(page, dir) {
  await page.setViewportSize(SPRITE);
  for (let m = 0; m < MOUTH_LEVELS; m++) {
    for (const blink of [0, 1]) {
      await page.setContent(spriteHtml(m, blink));
      await page.screenshot({ path: `${dir}/sprite-${m}-${blink}.png`, omitBackground: true, clip: { x: 0, y: 0, ...SPRITE } });
    }
  }
}

export function audioSeconds(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
}

/** Mouth level (0 closed .. 3 wide) for every 1/FPS second of the clip, from its loudness. */
export function mouthTrack(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'], { maxBuffer: 1 << 28 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  const per = Math.floor(16000 / FPS);
  const rms = [];
  for (let i = 0; i + per <= samples.length; i += per) {
    let sum = 0;
    for (let j = i; j < i + per; j++) sum += samples[j] * samples[j];
    rms.push(Math.sqrt(sum / per));
  }
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.9)] || 1;
  const raw3 = rms.map((v) => (v < loud * 0.1 ? 0 : v < loud * 0.35 ? 1 : v < loud * 0.7 ? 2 : 3));
  // A median of three keeps the mouth from flickering on every frame.
  return raw3.map((_, i) => [raw3[i - 1] ?? raw3[i], raw3[i], raw3[i + 1] ?? raw3[i]].sort((a, b) => a - b)[1]);
}

/** ffmpeg concat list for the character: speaking frames, then a closed mouth for the pause that follows. */
export function characterList(levels, totalSeconds, dir) {
  const frames = Math.ceil(totalSeconds * FPS);
  const lines = [];
  for (let i = 0; i < frames; i++) {
    // About every 3.4 seconds the eyes shut for two frames.
    const blink = i % 51 >= 49 ? 1 : 0;
    lines.push(`file '${dir}/sprite-${levels[i] ?? 0}-${blink}.png'`, `duration ${(1 / FPS).toFixed(4)}`);
  }
  lines.push(lines.at(-2));
  return lines.join('\n');
}
