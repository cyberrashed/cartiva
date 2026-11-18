"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ className = "identity-secondary" }: { className?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError("We couldn’t sign you out. Please try again.");
        setPending(false);
        return;
      }
      // A fresh document discards the previously authenticated client view after sign-out.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/sign-in");
    } catch {
      setError("We couldn’t connect. Please try signing out again.");
      setPending(false);
    }
  }

  return <div className="identity-signout">
    <button className={className} type="button" onClick={signOut} disabled={pending}>{pending ? "Signing out…" : "Sign out"}</button>
    {error && <p className="identity-error" role="alert">{error}</p>}
  </div>;
}
