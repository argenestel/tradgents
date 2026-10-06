"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches this page's server data on an interval while the tab is visible, so new trades appear without a reload. */
export function LiveRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
