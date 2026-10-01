import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router';
import { colors } from '@/theme/tokens';
import { Icon, type IconName } from '@/ui/Icon';

const icon = (name: IconName) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={22} color={color} />;
  };

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 8);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 58 + bottom,
          paddingTop: 6,
          paddingBottom: bottom,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Holdings', tabBarIcon: icon('holdings') }} />
      <Tabs.Screen name="sip" options={{ title: 'SIP', tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: icon('activity') }} />
      <Tabs.Screen name="alerts" options={{ title: 'Alerts', tabBarIcon: icon('bell') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('user') }} />
    </Tabs>
  );
}
