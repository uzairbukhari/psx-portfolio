// Shared look for the social videos and cards: the space background and the 3D "Sip" mascot (cut out, transparent).
// Both files live in scripts/assets; the renderers inline them as data URLs so the pages need no network or files.
import { readFileSync } from 'node:fs';

const asset = (name) => readFileSync(new URL(`./assets/${name}`, import.meta.url));

/** CSS `background` value: the space image under a dark veil so text stays readable. */
export const spaceBackground = `linear-gradient(rgba(7,11,24,.42),rgba(7,11,24,.42)),url(data:image/jpeg;base64,${asset('space-bg.jpg').toString('base64')}) center/cover no-repeat #070b18`;

/** The Sip mascot as a data URL (PNG with transparent background, 538x857). */
export const sipDataUrl = `data:image/png;base64,${asset('sip-3d.png').toString('base64')}`;
export const SIP_RATIO = 538 / 857;
