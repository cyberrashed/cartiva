"use client";

import { useSearchParams } from "next/navigation";

/** Shown when a demo sign-in could not be completed (for example, during a deploy). */
export function DemoNotice() {
  if (useSearchParams().get("unavailable") !== "1") return null;
  return <p className="checkout-alert" role="alert">The demo account isn&apos;t available right now. Please try again in a minute, or browse as a guest.</p>;
}
