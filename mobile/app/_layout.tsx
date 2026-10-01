import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { BiometricLockProvider } from '@/auth/BiometricLock';
import { SignIn } from '@/screens/SignIn';
import { colors } from '@/theme/tokens';

function Root() {
  const { state } = useAuth();
  if (state.status === 'loading')
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  if (state.status === 'signedOut') return <SignIn />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.foreground, fontWeight: '700' },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="company/[ticker]" options={{ title: '' }} />
      <Stack.Screen name="import" options={{ title: 'Import' }} />
      <Stack.Screen name="reports" options={{ title: 'Reports' }} />
      <Stack.Screen name="picks" options={{ title: 'Monthly Picks' }} />
      <Stack.Screen name="quote" options={{ presentation: 'modal', title: 'Price' }} />
      <Stack.Screen name="transaction" options={{ presentation: 'modal', title: 'Add transaction' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="light" />
        <BiometricLockProvider>
          <Root />
        </BiometricLockProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
