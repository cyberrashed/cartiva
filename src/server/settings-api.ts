import "server-only";
import { z } from "zod";
import { fieldErrorsFrom } from "../lib/catalog-admin";
import { hasPermission } from "../lib/permissions";
import { auth } from "./auth";
import { SettingsError } from "./checkout-settings";
import { readSameOriginJson } from "./json-body";

export function settingsResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function settingsErrorResponse(error: unknown) {
  if (error instanceof SettingsError) {
    return settingsResponse({ error: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) }, error.status);
  }
  if (error instanceof z.ZodError) {
    return settingsResponse({ error: "Check the highlighted settings and try again.", fieldErrors: fieldErrorsFrom(error) }, 400);
  }
  console.error("Settings request failed", error instanceof Error ? error.message : error);
  return settingsResponse({ error: "We could not save these settings. Please try again." }, 500);
}

/** Shipping and coupon settings require checkout:manage, read fresh from the session. */
export async function requireCheckoutManager(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new SettingsError(401, "Sign in to manage checkout settings.");
  if (!hasPermission(session.user.role, "checkout:manage")) throw new SettingsError(403, "You do not have access to checkout settings.");
  return session.user;
}

export function readSettingsBody(request: Request): Promise<unknown> {
  return readSameOriginJson(request, 65_536, {
    forbidden: "This request must come from Cartiva.",
    type: "Send the settings as JSON.",
    tooLarge: "These settings are too large.",
    invalid: "Send valid settings.",
  }, (status, message) => new SettingsError(status, message));
}
