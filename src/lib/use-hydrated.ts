import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False during server rendering and hydration, true once React controls the page.
 * Forms that collect personal data keep submission disabled until then, so a
 * fast submit cannot fall back to a native GET that puts field values in the URL.
 */
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
