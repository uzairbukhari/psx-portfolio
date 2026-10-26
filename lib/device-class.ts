// Coarse device facts for usage analytics, read by the server from the request: operating system, browser family,
// form factor and country, each from a closed list. The raw User-Agent and IP are never stored. Pure module.
import type { Platform } from './analytics-events.ts';

export const OSES = ['windows', 'macos', 'linux', 'chromeos', 'android', 'ios', 'other'] as const;
export const BROWSERS = ['chrome', 'safari', 'firefox', 'edge', 'samsung', 'opera', 'app', 'other'] as const;
export const FORM_FACTORS = ['phone', 'tablet', 'desktop'] as const;

export type DeviceClass = {
  os: (typeof OSES)[number];
  browser: (typeof BROWSERS)[number];
  formFactor: (typeof FORM_FACTORS)[number];
};

/** Classifies a User-Agent string. Phone apps report `app` as the browser and take the OS from the platform. */
export function classifyDevice(userAgent: string | null, platform: Platform): DeviceClass {
  const ua = userAgent ?? '';
  if (platform === 'android' || platform === 'ios')
    return { os: platform, browser: 'app', formFactor: /tablet|ipad/i.test(ua) ? 'tablet' : 'phone' };
  const os: DeviceClass['os'] = /iphone|ipad|ipod/i.test(ua)
    ? 'ios'
    : /android/i.test(ua)
      ? 'android'
      : /cros/i.test(ua)
        ? 'chromeos'
        : /windows/i.test(ua)
          ? 'windows'
          : /mac os x|macintosh/i.test(ua)
            ? 'macos'
            : /linux/i.test(ua)
              ? 'linux'
              : 'other';
  const browser: DeviceClass['browser'] = /edg\//i.test(ua)
    ? 'edge'
    : /opr\/|opera/i.test(ua)
      ? 'opera'
      : /samsungbrowser/i.test(ua)
        ? 'samsung'
        : /firefox|fxios/i.test(ua)
          ? 'firefox'
          : /chrome|crios|chromium/i.test(ua)
            ? 'chrome'
            : /safari/i.test(ua)
              ? 'safari'
              : 'other';
  // iPadOS asks for the desktop site, so an iPad can look like a Mac; that one is counted as desktop.
  const formFactor: DeviceClass['formFactor'] = /ipad|tablet|(android(?!.*mobile))/i.test(ua)
    ? 'tablet'
    : /mobi|iphone|ipod/i.test(ua)
      ? 'phone'
      : 'desktop';
  return { os, browser, formFactor };
}

/** Cloudflare's two-letter country code, or null for unknown (XX) and Tor (T1). */
export function cleanCountry(code: unknown): string | null {
  return typeof code === 'string' && /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1' ? code : null;
}
