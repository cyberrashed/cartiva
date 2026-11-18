"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { useHydrated } from "@/lib/use-hydrated";

export function AuthForm({ mode, returnTo }: { mode: "sign-in" | "sign-up"; returnTo: string }) {
  const isSignUp = mode === "sign-up";
  const hydrated = useHydrated();
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const otherRoute = isSignUp ? "/sign-in" : "/sign-up";

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get("name") ?? "").trim();
    const email = String(fields.get("email") ?? "").trim();
    const password = String(fields.get("password") ?? "");
    if (isSignUp && name.length < 2) {
      setError("Enter a name with at least two characters.");
      return;
    }
    setError("");
    setPending(true);

    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.status === 429
          ? "Too many attempts. Please wait a moment, then try again."
          : isSignUp
            ? "We couldn’t create your account. Check your details or try signing in."
            : "We couldn’t sign you in. Check your email and password, then try again.");
        setPending(false);
        return;
      }
      window.location.assign(returnTo);
    } catch {
      setError("We couldn’t connect. Please try again in a moment.");
      setPending(false);
    }
  }

  return <main id="main" className="identity-page" data-ui>
    <div className="identity-access">
      <section className="identity-form-section" aria-labelledby="identity-title">
        <Link className="identity-back" href="/products">← Back to the collection</Link>
        <h1 id="identity-title">{isSignUp ? "Create your account" : "Sign in"}</h1>
        <p className="identity-intro">{isSignUp ? "Make a little room for your next good find." : "Your corner of Cartiva, right where you left it."}</p>
        <form method="post" onSubmit={submit} aria-busy={pending}>
          <fieldset disabled={pending}>
            <legend className="identity-sr-only">{isSignUp ? "Create account details" : "Sign-in details"}</legend>
            {isSignUp && <label className="identity-field" htmlFor="identity-name">Name
              <input id="identity-name" name="name" autoComplete="name" required minLength={2} maxLength={100} />
            </label>}
            <label className="identity-field" htmlFor="identity-email">Email address
              <input id="identity-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} />
            </label>
            <div className="identity-field">
              <label htmlFor="identity-password">Password</label>
              <div className="identity-password">
                <input id="identity-password" name="password" type={showPassword ? "text" : "password"} autoComplete={isSignUp ? "new-password" : "current-password"} required minLength={12} maxLength={128} aria-describedby={isSignUp ? "identity-password-hint" : undefined} />
                <button type="button" onClick={() => setShowPassword(current => !current)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? "Hide" : "Show"}</button>
              </div>
              {isSignUp && <span className="identity-hint" id="identity-password-hint">Use 12–128 characters.</span>}
            </div>
            {error && <p className="identity-error" role="alert" ref={errorRef} tabIndex={-1}>{error}</p>}
            <button className="identity-primary" type="submit" disabled={!hydrated}>{pending ? (isSignUp ? "Creating account…" : "Signing in…") : (isSignUp ? "Create account" : "Sign in")}</button>
          </fieldset>
        </form>
        <p className="identity-switch">{isSignUp ? "Already have an account?" : "New to Cartiva?"} <Link href={`${otherRoute}?returnTo=${encodeURIComponent(returnTo)}`}>{isSignUp ? "Sign in" : "Create an account"}</Link></p>
        <p className="identity-note">Local preview · Your account is saved on this computer. Email verification and password recovery are not available yet.</p>
      </section>
      <figure className="identity-photo">
        <div><Image src="/images/lounge-chair.jpg" alt="Cartiva’s sample Arc lounge chair beside soft gray curtains" fill sizes="(max-width: 800px) 0px, (max-width: 1200px) 45vw, 572px" loading="eager" /></div>
        <figcaption><span>A place for good things.</span><span>Cartiva collection</span></figcaption>
      </figure>
    </div>
  </main>;
}
