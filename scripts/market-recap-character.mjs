// "Sip", the animated Sipwise character for the daily market recap video: the 3D mascot, who bounces with the voice-over
// and nods now and then. Sprite drawing and audio maths; the renderer composes it.
import { execFileSync } from 'node:child_process';
import { sipDataUrl } from './social-brand.mjs';

export const FPS = 15;
export const SPRITE = { width: 400, height: 560 };
export const MOUTH_LEVELS = 4;

// "Sip" is a still 3D picture (scripts/assets/sip-3d.png), so he cannot open his mouth. Instead he talks with a bounce:
// the louder the voice, the more he stretches up and grows a little. A blink frame is a quick small squash (a nod).
const BOUNCE = [
  { scale: 1, lift: 0 },
  { scale: 1.015, lift: 4 },
  { scale: 1.03, lift: 9 },
  { scale: 1.05, lift: 15 },
];

export function spriteHtml(level, blink) {
  const { scale, lift } = BOUNCE[level];
  const squash = blink ? 0.975 : 1;
  const width = SPRITE.width - 40;
  return `<html><body style="margin:0;background:transparent"><div style="position:relative;width:${SPRITE.width}px;height:${SPRITE.height}px"><img src="${sipDataUrl}" style="position:absolute;left:20px;bottom:${12 + lift}px;width:${width}px;transform-origin:50% 100%;transform:scale(${scale},${scale * squash})"></div></body></html>`;
}

/** Writes sprite-<level>-<blink>.png (transparent) for every bounce level, plain and nodding. */
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
