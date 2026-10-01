import { Image, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { useUnreadAlerts } from '@/data/usePortfolio';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';
import { Icon } from './Icon';

/**
 * Header for the four tab screens: title, a bell with the unread count (opens the Inbox) and the avatar
 * (opens More). Both are 48 dp targets.
 */
export function AppBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { colors } = useTheme();
  const { state } = useAuth();
  const unread = useUnreadAlerts();
  const user = state.status === 'signedIn' ? state.user : null;
  const initial = (user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 56 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.ink, ...type.title }} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={{ color: colors.muted, ...type.caption }}>{subtitle}</Text> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={unread ? `Inbox, ${unread} unread` : 'Inbox'}
        onPress={() => router.push('/inbox')}
        style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.raised : 'transparent' })}
      >
        <Icon name="bell" size={24} color={colors.ink} />
        {unread ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.loss, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}
          >
            {/* The badge sits on the loss colour, so its text is the surface colour (white in light, dark in dark). */}
            <Text style={{ color: colors.surface, fontSize: 11, lineHeight: 14, fontWeight: '700' }} allowFontScaling={false}>
              {unread > 9 ? '9+' : unread}
            </Text>
          </View>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More: account, security and settings"
        onPress={() => router.push('/more')}
        style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.raised : 'transparent' })}
      >
        {user?.picture ? (
          <Image accessibilityIgnoresInvertColors source={{ uri: user.picture }} style={{ width: 32, height: 32, borderRadius: 16 }} />
        ) : (
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>{initial}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
