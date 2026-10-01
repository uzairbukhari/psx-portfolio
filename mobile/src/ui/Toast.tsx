import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles } from '@/theme/ThemeProvider';
import { radii } from '@/theme/tokens';

type ToastInput = { message: string; actionLabel?: string; onAction?: () => void | Promise<void>; durationMs?: number };
type ToastState = ToastInput & { id: number };

const ToastContext = createContext<{ show: (t: ToastInput) => void }>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

/** One toast at a time, shown above the navigator; the action (for example Undo) stays for `durationMs` (8 s). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [acting, setActing] = useState(false);
  const idRef = useRef(0);
  const insets = useSafeAreaInsets();
  const styles = useStyles();

  const show = useCallback((t: ToastInput) => {
    setActing(false);
    setToast({ ...t, id: ++idRef.current });
    AccessibilityInfo.announceForAccessibility(t.actionLabel ? `${t.message}. ${t.actionLabel} available.` : t.message);
  }, []);

  useEffect(() => {
    if (!toast || acting) return;
    const timer = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), toast.durationMs ?? 8000);
    return () => clearTimeout(timer);
  }, [toast, acting]);

  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View pointerEvents="box-none" style={[styles.host, { bottom: Math.max(insets.bottom, 8) + 72 }]}>
          <View style={styles.toast} accessibilityLiveRegion="polite">
            <Text style={styles.message}>{toast.message}</Text>
            {toast.actionLabel && toast.onAction ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${toast.actionLabel}: ${toast.message}`}
                disabled={acting}
                hitSlop={8}
                onPress={async () => {
                  setActing(true);
                  try {
                    await toast.onAction?.();
                    // The action may have shown a follow-up toast; only remove this one.
                    setToast((cur) => (cur?.id === toast.id ? null : cur));
                  } catch (e) {
                    setToast({ id: ++idRef.current, message: e instanceof Error ? e.message : `${toast.actionLabel} failed.`, durationMs: 10000 });
                    setActing(false);
                  }
                }}
                style={styles.action}
              >
                <Text style={styles.actionText}>{acting ? 'Working…' : toast.actionLabel}</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" hitSlop={8} onPress={() => setToast(null)} style={styles.action}>
                <Text style={styles.actionText}>Dismiss</Text>
              </Pressable>
            )}
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

// The toast is inverted (ink on a dark chip in light, light chip in dark) so it stands out from the screen under it.
const useStyles = makeStyles((c) => ({
  host: { position: 'absolute', left: 16, right: 16 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c.ink,
    borderRadius: radii.control,
    paddingLeft: 16,
    paddingRight: 8,
    minHeight: 52,
    elevation: 6,
  },
  message: { flex: 1, color: c.bg, fontSize: 14, lineHeight: 20, fontWeight: '600', paddingVertical: 12 },
  action: { minHeight: 48, minWidth: 48, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: c.bg, fontWeight: '700', fontSize: 14, textDecorationLine: 'underline' },
}));
