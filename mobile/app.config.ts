import type { ExpoConfig } from 'expo/config';

// One codebase, three installable variants that can sit side by side on a phone.
// Public identifiers (not secrets) used when an `eas update` runs without the EAS environment variables.
const STAGING_API = 'https://psx-portfolio-sip-staging.suzairbukhari.workers.dev';
const WEB_CLIENT_ID = '50195098198-7mas6ulcfrkarsg088lk6l6evt5dh6sf.apps.googleusercontent.com';

const VARIANTS = {
  development: { suffix: '.dev', label: 'Sipwise Dev', api: 'http://localhost:3000' },
  staging: { suffix: '.staging', label: 'Sipwise Staging', api: process.env.API_BASE_URL || STAGING_API },
  production: { suffix: '', label: 'Sipwise', api: process.env.API_BASE_URL ?? '' },
} as const;

// Only `npm start` (which sets APP_VARIANT=development) points at localhost; a bare `eas update` that
// forgets APP_VARIANT lands on staging instead of breaking the installed app.
const variant = (process.env.APP_VARIANT || 'staging') as keyof typeof VARIANTS;
const v = VARIANTS[variant] ?? VARIANTS.staging;
// A production build or update without its environment would ship an app that cannot sign in or load data.
if (variant === 'production') {
  const missing = [!v.api && 'API_BASE_URL', !process.env.GOOGLE_WEB_CLIENT_ID && 'GOOGLE_WEB_CLIENT_ID'].filter(Boolean);
  if (missing.length) throw new Error(`APP_VARIANT=production needs ${missing.join(' and ')}. Use the EAS production environment (npm run update:production) or set them locally.`);
}
const bundleId = `com.uzairbukhari.sipwise${v.suffix}`;
// Reversed iOS OAuth client id, e.g. com.googleusercontent.apps.123-abc
const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;

const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID ?? '0e6be082-0810-45d2-9036-d8a93e53fdff';

const config: ExpoConfig = {
  name: v.label,
  slug: 'sipwise',
  version: '0.1.0',
  scheme: `sipwise${v.suffix.replace('.', '-')}`,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: '#05070d',
  ios: { bundleIdentifier: bundleId, supportsTablet: false },
  android: {
    package: bundleId,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#2563eb' },
    // Push notifications on Android need the Firebase config file; EAS supplies it as a file env var.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
  // Lets JS-only changes ship over the air (eas update) without using a build.
  runtimeVersion: { policy: 'appVersion' },
  updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}`, checkAutomatically: 'ON_LOAD' },
  plugins: [
    'expo-router',
    'expo-local-authentication',
    'expo-secure-store',
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, backgroundColor: '#05070d' }],
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#3b82f6' }],
    ...(iosUrlScheme ? [['@react-native-google-signin/google-signin', { iosUrlScheme }] as [string, object]] : []),
  ],
  experiments: { typedRoutes: true },
  extra: {
    variant,
    apiBaseUrl: v.api,
    googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID || (variant === 'production' ? '' : WEB_CLIENT_ID),
    googleIosClientId: process.env.GOOGLE_IOS_CLIENT_ID ?? '',
    // Public identifier (not a secret); EAS cloud builds don't see the local .env.
    eas: { projectId: EAS_PROJECT_ID },
  },
};

export default config;
