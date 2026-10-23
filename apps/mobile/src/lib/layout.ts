import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Visible tab bar height, above the system navigation area. */
export const TAB_BAR_HEIGHT = 58;

/**
 * Space the floating tab bar covers, including Android's gesture/3-button
 * navigation area (apps draw edge-to-edge, so the system bar overlaps content).
 */
export function useTabBarSpace() {
  return TAB_BAR_HEIGHT + useSafeAreaInsets().bottom;
}

/** Bottom padding for screens without the tab bar. */
export function useSystemBottom() {
  return useSafeAreaInsets().bottom;
}
