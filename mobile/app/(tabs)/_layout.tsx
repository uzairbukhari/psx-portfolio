import { View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs, router, usePathname } from 'expo-router';
import { usePortfolio } from '@/data/usePortfolio';
import { useTheme } from '@/theme/ThemeProvider';
import { Icon, type IconName } from '@/ui/Icon';
import { ScrollAwareFab, ScrollChromeProvider } from '@/ui/ScrollAwareFab';

const TAB_HEIGHT = 64;

/** Icon inside a pill that fills with the tonal colour when its tab is selected (colour is not the only cue: the label is bold too). */
function TabIcon({ name, focused, color }: { name: IconName; focused: boolean; color: ColorValue }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? colors.primarySoft : 'transparent' }}>
      <Icon name={name} size={22} color={focused ? colors.primary : color} />
    </View>
  );
}

const tab = (name: IconName) =>
  function Icon_({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <TabIcon name={name} focused={focused} color={color} />;
  };

/** The Add action floats over Today, Portfolio and Activity (Plan has its own Record action) and slides away while a list scrolls down. */
function AddButton({ bottom }: { bottom: number }) {
  const path = usePathname();
  const p = usePortfolio();
  if (!['/', '/portfolio', '/activity'].includes(path)) return null;
  return (
    <ScrollAwareFab
      bottom={bottom}
      disabled={p.offline}
      onPress={() => router.push('/transaction')}
      hint="Record a buy, sale, dividend, split or price"
    />
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const bottom = Math.max(insets.bottom, 8);
  return (
    <ScrollChromeProvider>
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.bg },
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.line,
            borderTopWidth: 1,
            height: TAB_HEIGHT + bottom,
            paddingTop: 6,
            paddingBottom: bottom,
          },
          tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
          tabBarActiveTintColor: colors.ink,
          tabBarInactiveTintColor: colors.muted,
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: tab('home') }} />
        <Tabs.Screen name="portfolio" options={{ title: 'Portfolio', tabBarIcon: tab('pie') }} />
        <Tabs.Screen name="plan" options={{ title: 'Plan', tabBarIcon: tab('steps') }} />
        <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: tab('list') }} />
        {/* Old tab paths: they stay routable (deep links, saved notifications) but only redirect. */}
        <Tabs.Screen name="sip" options={{ href: null }} />
        <Tabs.Screen name="alerts" options={{ href: null }} />
        <Tabs.Screen name="account" options={{ href: null }} />
      </Tabs>
      <AddButton bottom={TAB_HEIGHT + bottom + 16} />
    </View>
    </ScrollChromeProvider>
  );
}
