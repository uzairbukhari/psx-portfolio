// Bottom sheet with a fading scrim, a spring entrance and drag-to-dismiss. Replaces kit.tsx#Sheet, whose
// `animationType="slide"` slides the scrim up with the sheet and cannot be dragged closed.
// The position is a Reanimated shared value and the drag is a Gesture Handler pan, so following the finger, the
// release spring and the scrim fade all run on the UI thread and never wait on JS (needs the native build with
// react-native-reanimated and react-native-gesture-handler).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, radii, type } from '@/theme/tokens';
import { useReduceMotion } from './kit';
import { motion } from './motion';

const DISMISS_DISTANCE = 96;
/** Points per second (Gesture Handler reports velocity per second). */
const DISMISS_VELOCITY = 900;
const SPRING = { damping: motion.spring.damping, stiffness: motion.spring.stiffness, mass: motion.spring.mass };
const EASE_OUT = Easing.bezier(0.2, 0, 0, 1);

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
  const y = useSharedValue(offscreen);
  const closing = useSharedValue(false);
  const [mounted, setMounted] = useState(visible);
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;
  // The latest onClose, read through a ref so a stale callback never fires after a re-render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Scrim follows the sheet: fully dark when open, clear when the sheet is off screen.
  const scrimStyle = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, offscreen * 0.6], [1, 0], Extrapolation.CLAMP) }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  useEffect(() => {
    if (visible) {
      closing.value = false;
      setMounted(true);
      y.value = offscreen;
      // Start on the next frame so the Modal has laid out the sheet first.
      const raf = requestAnimationFrame(() => {
        y.value = reduceRef.current ? withTiming(0, { duration: 0 }) : withSpring(0, SPRING);
      });
      return () => cancelAnimationFrame(raf);
    }
    if (mounted) animateOut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /** Runs on the JS thread once the slide-out has finished. */
  function finish(notify: boolean) {
    setMounted(false);
    if (notify) onCloseRef.current();
  }
  function animateOut(notify?: boolean) {
    if (closing.value) return;
    closing.value = true;
    y.value = withTiming(offscreen, { duration: reduceRef.current ? 0 : motion.base, easing: EASE_OUT }, (finished) => {
      if (!finished) return;
      scheduleOnRN(finish, Boolean(notify));
    });
  }
  /** User-initiated close (scrim, back, drag): animate first, then tell the parent. */
  const requestClose = () => animateOut(true);

  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetX([-24, 24])
    .onUpdate((e) => {
      if (!closing.value) y.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (closing.value) return;
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        closing.value = true;
        y.value = withTiming(offscreen, { duration: motion.base, easing: EASE_OUT }, (finished) => {
          if (!finished) return;
          scheduleOnRN(finish, true);
        });
      } else {
        y.value = withSpring(0, SPRING);
      }
    });

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={requestClose}>
      {/* A Modal is a separate native window, so it needs its own gesture root. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, scrimStyle]}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close" onPress={requestClose} />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[sheetStyle, {
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
          }]}
        >
          {/* The handle and title are the drag area; the body scrolls normally. */}
          <GestureDetector gesture={pan}>
          <View style={{ paddingHorizontal: layout.gutter, paddingTop: 8, paddingBottom: 4, gap: 8 }}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.outline, opacity: 0.5, alignSelf: 'center', marginVertical: 6 }} />
            {title ? (
              <Text style={{ color: colors.ink, ...type.title }} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
          </View>
          </GestureDetector>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: 8, paddingBottom: footer ? 8 : 4, gap: 12 }}>
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: layout.gutter, paddingTop: 8 }}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}
