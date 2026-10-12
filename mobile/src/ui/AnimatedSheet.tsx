// Bottom sheet with a fading scrim, a spring entrance and drag-to-dismiss. Replaces kit.tsx#Sheet, whose
// `animationType="slide"` slides the scrim up with the sheet and cannot be dragged closed.
// OTA-safe: only react-native's Animated + PanResponder. With Reanimated and Gesture Handler in a later native
// build, swap PanResponder for Gesture.Pan() and keep the same props.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Dimensions, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, radii, type } from '@/theme/tokens';
import { motion, useReduceMotion } from './motion';

const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.9;

export function AnimatedSheet({
  visible,
  title,
  onClose,
  children,
  footer,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the scrolling body (a primary action). */
  footer?: ReactNode;
}) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const offscreen = Dimensions.get('window').height;
  const [y] = useState(() => new Animated.Value(offscreen));
  const [mounted, setMounted] = useState(visible);
  const closing = useRef(false);

  // Scrim follows the sheet: fully dark when open, clear when the sheet is off screen.
  const scrimOpacity = y.interpolate({ inputRange: [0, offscreen * 0.6], outputRange: [1, 0], extrapolate: 'clamp' });

  useEffect(() => {
    if (visible) {
      closing.current = false;
      setMounted(true);
      y.setValue(offscreen);
      const a = reduce
        ? Animated.timing(y, { toValue: 0, duration: 0, useNativeDriver: true })
        : Animated.spring(y, { toValue: 0, useNativeDriver: true, ...motion.spring });
      // Start on the next frame so the Modal has laid out the sheet first.
      const raf = requestAnimationFrame(() => a.start());
      return () => cancelAnimationFrame(raf);
    }
    if (mounted) animateOut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function animateOut(after?: () => void) {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(y, { toValue: offscreen, duration: reduce ? 0 : motion.base, easing: motion.easeOut, useNativeDriver: true }).start(() => {
      setMounted(false);
      after?.();
    });
  }
  /** User-initiated close (scrim, back, drag): animate first, then tell the parent. */
  const requestClose = () => animateOut(onClose);

  // Created once; it reads the latest close function through a ref that an effect keeps current.
  const requestCloseRef = useRef(requestClose);
  useLayoutEffect(() => {
    requestCloseRef.current = requestClose;
  });
  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) requestCloseRef.current();
        else Animated.spring(y, { toValue: 0, useNativeDriver: true, ...motion.spring }).start();
      },
      onPanResponderTerminate: () => Animated.spring(y, { toValue: 0, useNativeDriver: true, ...motion.spring }).start(),
    }),
  );

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={requestClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: scrimOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close" onPress={requestClose} />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={{
            transform: [{ translateY: y }],
            maxHeight: '90%',
            // Sheets sit on `surface` (not `bg`) so they separate from the screen in dark mode too.
            backgroundColor: colors.surface,
            borderTopLeftRadius: radii.sheet,
            borderTopRightRadius: radii.sheet,
            paddingBottom: Math.max(insets.bottom, 12),
            elevation: 16,
            shadowColor: scheme === 'dark' ? '#000' : colors.ink,
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: -4 },
          }}
        >
          {/* The handle and title are the drag area; the body scrolls normally. */}
          <View {...pan.panHandlers} style={{ paddingHorizontal: layout.gutter, paddingTop: 8, paddingBottom: 4, gap: 8 }}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.outline, opacity: 0.5, alignSelf: 'center', marginVertical: 6 }} />
            {title ? (
              <Text style={{ color: colors.ink, ...type.title }} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: 8, paddingBottom: footer ? 8 : 4, gap: 12 }}>
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: layout.gutter, paddingTop: 8 }}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
