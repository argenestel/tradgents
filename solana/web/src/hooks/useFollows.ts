import { useCallback, useMemo, useSyncExternalStore } from "react";

const KEY = "tradgents:follows";
const EVENT = "tradgents:follows-changed";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}
const snapshot = () => {
  try {
    return localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
};

/** Follows live in this browser only (localStorage) until accounts exist. */
export function useFollows() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  const list = useMemo<string[]>(() => {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }, [raw]);

  const toggle = useCallback(
    (slug: string) => {
      const next = list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage blocked: follow just won't persist */
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [list],
  );

  return { follows: list, isFollowing: (slug: string) => list.includes(slug), toggle };
}
