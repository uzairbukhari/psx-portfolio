import { ActivityIndicator, AppState, Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { BiometricLockProvider } from '@/auth/BiometricLock';
import { PushBridge } from '@/push/PushBridge';
import { SignIn } from '@/screens/SignIn';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { ToastProvider } from '@/ui/Toast';
import { PortfolioSelectionProvider } from '@/data/PortfolioSelection';
import { VaultGate } from '@/vault/VaultProvider';

function Root() {
  const { state } = useAuth();
  const { colors } = useTheme();
  if (state.status === 'loading')
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  if (state.status === 'signedOut') return <SignIn />;
  return (
    <ToastProvider>
      <VaultGate>
        <PortfolioSelectionProvider>
        <PushBridge />
        <ErrorBoundary>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.primary,
            headerTitleStyle: { color: colors.ink, fontWeight: '700' },
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="company/[ticker]" options={{ title: '' }} />
          <Stack.Screen name="inbox" options={{ title: 'Inbox' }} />
          <Stack.Screen name="more" options={{ title: 'More' }} />
          <Stack.Screen name="portfolios" options={{ title: 'Portfolios' }} />
          <Stack.Screen name="restore" options={{ title: 'Restore backup' }} />
          <Stack.Screen name="import" options={{ title: 'Import' }} />
          {/* Old paths that now live inside Portfolio and Plan; they redirect, so they have no header. */}
          <Stack.Screen name="reports" options={{ headerShown: false }} />
          <Stack.Screen name="picks" options={{ headerShown: false }} />
          {/* Plain pushed screens, not native modals: closing a native-stack modal after a save left a white,
              unresponsive layer over the app on Android. */}
          <Stack.Screen name="targets" options={{ title: 'Targets' }} />
          <Stack.Screen name="received" options={{ title: 'Dividend' }} />
          <Stack.Screen name="quote" options={{ title: 'Price' }} />
          <Stack.Screen name="transaction" options={{ title: 'Add transaction' }} />
        </Stack>
        </ErrorBoundary>
        </PortfolioSelectionProvider>
      </VaultGate>
    </ToastProvider>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  // Refetch stale data (prices, portfolio revision) whenever the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
    });
    return () => sub.remove();
  }, []);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BiometricLockProvider>
            <Root />
          </BiometricLockProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
