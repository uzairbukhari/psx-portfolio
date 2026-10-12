import { useMemo, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { usePortfolio, useUnreadAlerts } from '@/data/usePortfolio';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';
import { Icon } from './Icon';
import { ALL_PORTFOLIOS } from '@shared/portfolio-account.ts';
import { moneyShort } from '@shared/portfolio.ts';
import { contentsLabel, portfolioContents } from '@/data/scope';
import { usePortfolioTotals } from '@/data/useScope';
import { PortfolioChooser, PortfolioPill, type PortfolioOption } from './PortfolioChooser';

/**
 * Header for the four tab screens: the portfolio chooser, the title, a bell with the unread count (opens the
 * Inbox) and the avatar (opens More). Both buttons are 48 dp targets.
 */
export function AppBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { colors } = useTheme();
  const { state } = useAuth();
  const unread = useUnreadAlerts();
  const portfolio = usePortfolio();
  const [choosing, setChoosing] = useState(false);
  const user = state.status === 'signedIn' ? state.user : null;
  const initial = (user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase();
  const several = (portfolio.account?.portfolios.length ?? 0) > 1;
  const scope = portfolio.isAll ? 'All portfolios' : portfolio.portfolioName;
  // Values and shares are worked out only while the chooser is open.
  const totals = usePortfolioTotals(choosing);
  const options = useMemo<PortfolioOption[]>(() => {
    if (!choosing) return [];
    const entries = portfolio.account?.portfolios ?? [];
    const each = entries.map((e) => {
      const row = totals?.portfolios.find((x) => x.id === e.id);
      return { id: e.id, name: e.name, detail: contentsLabel(portfolioContents(e.portfolio)), value: row ? moneyShort(row.value) : null, share: row?.share ?? null, locked: Boolean(e.locked) };
    });
    return [{ id: ALL_PORTFOLIOS, name: 'All portfolios', detail: 'Everything together', value: totals ? moneyShort(totals.total.value) : null }, ...each];
  }, [choosing, portfolio.account, totals]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 56 }}>
      <View style={{ flex: 1, gap: 2 }}>
        {several ? <PortfolioPill label={scope} open={choosing} onPress={() => setChoosing(true)} /> : null}
        <Text style={{ color: colors.ink, ...type.title }} accessibilityRole="header">{title}</Text>
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
      {several ? (
        <PortfolioChooser
          visible={choosing}
          options={options}
          selectedId={portfolio.isAll ? ALL_PORTFOLIOS : (portfolio.targetId ?? ALL_PORTFOLIOS)}
          onSelect={portfolio.select}
          onClose={() => setChoosing(false)}
          onManage={() => {
            setChoosing(false);
            router.push('/portfolios');
          }}
        />
      ) : null}
    </View>
  );
}
