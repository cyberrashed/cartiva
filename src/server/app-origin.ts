import "server-only";

const loopbackHosts = ["127.0.0.1", "localhost", "[::1]"];

/**
 * Origins allowed to call Cartiva's APIs: BETTER_AUTH_URL itself and, only when it
 * is a local address, the other local names for the same port. `next dev` prints
 * localhost while the local setup uses 127.0.0.1, and both are the same machine.
 */
export function appOrigins(): string[] {
  const configured = process.env.BETTER_AUTH_URL;
  if (!configured) return [];
  const url = new URL(configured);
  if (!loopbackHosts.includes(url.hostname)) return [url.origin];
  const port = url.port ? `:${url.port}` : "";
  return [url.origin, ...loopbackHosts.filter(host => host !== url.hostname).map(host => `${url.protocol}//${host}${port}`)];
}

/** The request's Origin header when it is one of `appOrigins()`, otherwise null. */
export function trustedRequestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  return origin && appOrigins().includes(origin) ? origin : null;
}
