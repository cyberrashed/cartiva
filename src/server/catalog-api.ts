import "server-only";
import { z } from "zod";
import { fieldErrorsFrom } from "../lib/catalog-admin";
import { hasPermission } from "../lib/permissions";
import { auth } from "./auth";
import { CatalogError } from "./catalog";
import { readSameOriginJson } from "./json-body";

export function catalogResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function catalogErrorResponse(error: unknown) {
  if (error instanceof CatalogError) {
    return catalogResponse({ error: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) }, error.status);
  }
  if (error instanceof z.ZodError) {
    return catalogResponse({ error: "Check the highlighted product details and try again.", fieldErrors: fieldErrorsFrom(error) }, 400);
  }
  console.error("Catalog request failed", error instanceof Error ? error.message : error);
  return catalogResponse({ error: "We could not complete this request. Please try again." }, 500);
}

/** Resolves the signed-in user and requires catalog:manage; the role is read fresh from the session. */
export async function requireCatalogManager(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new CatalogError(401, "Sign in to manage the catalog.");
  if (!hasPermission(session.user.role, "catalog:manage")) throw new CatalogError(403, "You do not have access to manage the catalog.");
  return session.user;
}

export function readCatalogBody(request: Request): Promise<unknown> {
  return readSameOriginJson(request, 65_536, {
    forbidden: "This request must come from Cartiva.",
    type: "Send the product as JSON.",
    tooLarge: "The product is too large.",
    invalid: "Send a valid product.",
  }, (status, message) => new CatalogError(status, message));
}
