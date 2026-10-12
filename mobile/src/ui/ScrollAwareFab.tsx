// The Add button slides away while the list scrolls down and comes back on any scroll up, so it never sits on
// top of the right-hand amounts (your Activity and Portfolio screenshots). Scroll position is fed to the native
// driver with Animated.event, so hiding and showing costs the JS thread nothing.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Animated, Pressable, Text, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { radii } from '@/theme/tokens';
import { Icon } from './Icon';
import { useReduceMotion, usePressScale } from './motion';

const HIDE_DISTANCE = 140;

// Each tab screen owns its scroll offset; the focused one is the "active" value the button follows, so switching
// tabs never inherits another list's position.
type Chrome = { active: Animated.Value; setActive: (value: Animated.Value) => void };
const ScrollChrome = createContext<Chrome | null>(null);

/** Wrap the tab navigator once (app/(tabs)/_layout.tsx). */
export function ScrollChromeProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(() => new Animated.Value(0));
  const value = useMemo<Chrome>(() => ({ active, setActive }), [active]);
  return <ScrollChrome.Provider value={value}>{children}</ScrollChrome.Provider>;
}

/**
 * For a tab screen's scroll view (`Animated.ScrollView` / `Animated.SectionList`): returns the `onScroll` handler,
 * and makes this screen's scroll offset the one the Add button follows while the screen is focused.
 * Pass `enabled = false` on screens without the button.
 */
export function useFabScroll(enabled = true): ((e: NativeSyntheticEvent<NativeScrollEvent>) => void) | undefined {
  const chrome = useContext(ScrollChrome);
  const setActive = chrome?.setActive;
  const [y] = useState(() => new Animated.Value(0));
  const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: true }), [y]);
  useFocusEffect(() => {
    if (enabled) setActive?.(y);
  });
  return enabled && chrome ? onScroll : undefined;
}

export function ScrollAwareFab({ bottom, disabled, onPress, label = 'Add', hint }: { bottom: number; disabled?: boolean; onPress: () => void; label?: string; hint?: string }) {
  const chrome = useContext(ScrollChrome);
  const { colors, scheme } = useTheme();
  const reduce = useReduceMotion();
  const press = usePressScale(0.94, reduce);
  // diffClamp turns "how far have we scrolled" into "how far since the last change of direction", capped, so the
  // button hides after 140 dp of scrolling down and returns as soon as the user scrolls up.
  const active = chrome?.active;
  const hidden = useMemo(() => {
    if (!active) return new Animated.Value(0);
    const clamped = Animated.diffClamp(active, 0, HIDE_DISTANCE);
    return clamped.interpolate({ inputRange: [0, HIDE_DISTANCE], outputRange: [0, bottom + 72], extrapolate: 'clamp' });
  }, [active, bottom]);
  return (
    <Animated.View style={{ position: 'absolute', right: 16, bottom, transform: [{ translateY: hidden }] }} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={disabled ? 'Unavailable while offline' : hint}
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={onPress}
        {...press.handlers}
      >
        <Animated.View
          style={[
            press.style,
            {
              height: 56,
              minWidth: 56,
              borderRadius: radii.card,
              paddingHorizontal: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: colors.primary,
              opacity: disabled ? 0.5 : 1,
              elevation: 6,
              shadowColor: scheme === 'dark' ? '#000' : colors.primary,
              shadowOpacity: 0.28,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
            },
          ]}
        >
          <Icon name="plus" size={22} color={colors.onPrimary} strokeWidth={2.4} />
          <Text style={{ color: colors.onPrimary, fontWeight: '700', fontSize: 16, lineHeight: 20 }}>{label}</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
