// Small, deliberate haptics: a tick when a segment or filter changes, a light tap when a refresh starts and a success
// buzz after a save. Never throws and never blocks: a device without a vibration motor, or a build without the native
// module, simply feels nothing.
let mod: typeof import('expo-haptics') | null | undefined;

function haptics() {
  if (mod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('expo-haptics') as typeof import('expo-haptics');
    } catch {
      mod = null;
    }
  }
  return mod;
}

const fire = (run: (h: typeof import('expo-haptics')) => Promise<void>) => {
  const h = haptics();
  if (h) run(h).catch(() => {});
};

/** Segment or filter chip changed. */
export const tickHaptic = () => fire((h) => h.selectionAsync());
/** Pull to refresh started. */
export const refreshHaptic = () => fire((h) => h.impactAsync(h.ImpactFeedbackStyle.Light));
/** A change was saved. */
export const successHaptic = () => fire((h) => h.notificationAsync(h.NotificationFeedbackType.Success));
