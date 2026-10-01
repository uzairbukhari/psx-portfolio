import { Text, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { colors } from '@/theme/tokens';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Holdings', tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: icon('≡') }} />
      <Tabs.Screen name="alerts" options={{ title: 'Alerts', tabBarIcon: icon('●') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('☺') }} />
    </Tabs>
  );
}
