import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** True after hydration. Wallet state only exists on the client, so gate wallet UI on this to avoid hydration mismatches. */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
