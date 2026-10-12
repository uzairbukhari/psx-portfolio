// Motion tokens and two small hooks shared by the redesigned components. Everything here runs with the native driver
// (opacity and transform only), so the animation itself never waits on the JS thread.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/** True when the phone asks for reduced motion ("Remove animations" on Android). */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

export const motion = {
  /** Press feedback, chip and segment changes. */
  fast: 120,
  /** Number changes, fades, small reveals. */
  base: 220,
  /** Chart reveals and sheet entrances. */
  slow: 520,
  easeOut: Easing.bezier(0.2, 0, 0, 1),
  /** Sheets and cards that settle (Material 3 "emphasized" feel, no bounce past 2 %). */
  spring: { damping: 26, stiffness: 260, mass: 1 },
} as const;

/** Scale-down-on-press for any Pressable: spread `handlers` on the Pressable and `style` on an Animated.View inside it. */
export function usePressScale(to = 0.97, reduce = false) {
  // useState's lazy initialiser creates the value once (useRef(new Animated.Value()) builds a new one every render).
  const [scale] = useState(() => new Animated.Value(1));
  const go = useCallback(
    (v: number) => {
      if (reduce) return;
      Animated.spring(scale, { toValue: v, useNativeDriver: true, ...motion.spring, stiffness: 420 }).start();
    },
    [scale, reduce],
  );
  const onPressIn = useCallback(() => go(to), [go, to]);
  const onPressOut = useCallback(() => go(1), [go]);
  return { handlers: { onPressIn, onPressOut }, style: { transform: [{ scale }] } };
}

/**
 * 0 → 1 each time `key` changes (skipped on first mount unless `onMount`). Drives "the number just changed"
 * transitions: fade + small rise for figures, a brief tint for live price ticks.
 */
export function useChangePulse(key: unknown, { duration = motion.base as number, onMount = false, reduce = false }: { duration?: number; onMount?: boolean; reduce?: boolean } = {}) {
  const [v] = useState(() => new Animated.Value(onMount && !reduce ? 0 : 1));
  const first = useRef(true);
  useEffect(() => {
    if (first.current && !onMount) {
      first.current = false;
      return;
    }
    first.current = false;
    if (reduce) {
      v.setValue(1);
      return;
    }
    v.setValue(0);
    const a = Animated.timing(v, { toValue: 1, duration, easing: motion.easeOut, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [key, v, duration, onMount, reduce]);
  return v;
}
