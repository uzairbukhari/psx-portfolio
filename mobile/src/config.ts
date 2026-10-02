import Constants from 'expo-constants';

type Extra = {
  variant?: string;
  apiBaseUrl?: string;
  googleWebClientId?: string;
  googleIosClientId?: string;
};
const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const config = {
  variant: extra.variant ?? 'development',
  apiBaseUrl: (extra.apiBaseUrl ?? '').replace(/\/$/, ''),
  googleWebClientId: extra.googleWebClientId ?? '',
  googleIosClientId: extra.googleIosClientId ?? '',
};
