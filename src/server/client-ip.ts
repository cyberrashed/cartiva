import "server-only";

/**
 * Forwarding headers are trusted only where the host sets them itself. Vercel
 * overwrites `x-real-ip` / `x-forwarded-for` at its edge; on a direct local
 * connection any client could forge them, so locally they are ignored.
 */
export const trustedIpHeaders: string[] = process.env.VERCEL ? ["x-real-ip", "x-forwarded-for"] : [];

/** The client IP when the host provides a trusted one, otherwise null (shared buckets). */
export function trustedClientIp(headers: Headers): string | null {
  for (const name of trustedIpHeaders) {
    const value = headers.get(name)?.split(",", 1)[0].trim();
    if (value) return value.slice(0, 64);
  }
  return null;
}
