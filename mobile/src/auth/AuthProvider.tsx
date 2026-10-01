import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import type { MeResponse, MobileSignInRequest, MobileSignInResponse } from '@shared/api-types.ts';
import { createApiClient, ApiRequestError, type ApiClient } from '@/api/client';
import { config } from '@/config';
import { tokenStore } from './token-store';

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: MeResponse };

type AuthContextValue = {
  state: AuthState;
  api: ApiClient;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const signedOutRef = useRef<() => void>(() => {});

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: config.apiBaseUrl,
        getToken: tokenStore.get,
        onUnauthorized: () => signedOutRef.current(),
      }),
    [],
  );

  const signOut = useCallback(async () => {
    await tokenStore.clear();
    await GoogleSignin.signOut().catch(() => {});
    setState({ status: 'signedOut' });
  }, []);
  signedOutRef.current = () => void signOut();

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: config.googleWebClientId,
      iosClientId: config.googleIosClientId || undefined,
    });
    let live = true;
    (async () => {
      if (!(await tokenStore.get())) return live && setState({ status: 'signedOut' });
      try {
        const user = await api.get<MeResponse>('/api/me');
        if (live) setState({ status: 'signedIn', user });
      } catch (e) {
        // Offline at launch keeps the token; only a rejected token signs out (via onUnauthorized).
        if (live && !(e instanceof ApiRequestError && e.status === 401)) setState({ status: 'signedOut' });
      }
    })();
    return () => {
      live = false;
    };
  }, [api]);

  const signIn = useCallback(async () => {
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response) || !response.data.idToken)
      throw new Error('Google sign-in was cancelled.');
    const body: MobileSignInRequest = {
      idToken: response.data.idToken,
      deviceName: Device.deviceName ?? Device.modelName ?? undefined,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    };
    const result = await api.post<MobileSignInResponse>('/api/auth/mobile/google', body, false);
    await tokenStore.set(result.token);
    setState({ status: 'signedIn', user: result.user });
  }, [api]);

  const value = useMemo(() => ({ state, api, signIn, signOut }), [state, api, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
