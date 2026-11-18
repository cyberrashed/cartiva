import { trustedRequestOrigin } from "@/server/app-origin";
import { demoAccounts, demoMode, signInDemo } from "@/server/demo";

/**
 * One-click sign-in to a shared demo account (public portfolio mode only).
 * A same-origin form post; the password never reaches the browser.
 */
export async function POST(request: Request) {
  if (!demoMode()) return new Response("Not found", { status: 404 });
  // Redirect back to the address the visitor used, where the session cookie is set.
  const origin = trustedRequestOrigin(request);
  if (!origin) return new Response("This request must come from Cartiva.", { status: 403 });
  const role = (await request.formData().catch(() => null))?.get("role");
  if (role !== "shopper" && role !== "admin") return new Response("Choose a demo account.", { status: 400 });
  const signedIn = await signInDemo(role, request.headers).catch(() => null);
  if (!signedIn?.ok) {
    return new Response(null, { status: 303, headers: { Location: `${origin}/demo?unavailable=1`, "Cache-Control": "no-store" } });
  }
  const response = new Response(null, { status: 303, headers: { Location: `${origin}${demoAccounts[role].landing}`, "Cache-Control": "no-store" } });
  for (const cookie of signedIn.headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
  return response;
}
