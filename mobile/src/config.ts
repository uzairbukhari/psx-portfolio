import Constants from 'expo-constants';
import { assertSecureApiUrl } from './vault/https';

type Extra = {
  variant?: string;
  apiBaseUrl?: string;
  googleWebClientId?: string;
  googleIosClientId?: string;
};
const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

const variant = extra.variant ?? 'development';
export const config = {
  variant,
  apiBaseUrl: assertSecureApiUrl((extra.apiBaseUrl ?? '').replace(/\/$/, ''), variant),
  googleWebClientId: extra.googleWebClientId ?? '',
  googleIosClientId: extra.googleIosClientId ?? '',
};
