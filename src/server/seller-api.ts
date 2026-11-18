import "server-only";
import { z } from "zod";
import { trustedRequestOrigin } from "./app-origin";
import { SellerApplicationError } from "./seller-applications";

export function sellerResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function sellerErrorResponse(error: unknown) {
  if (error instanceof SellerApplicationError) {
    return sellerResponse({ error: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) }, error.status);
  }
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = String(issue.path[0] === "fields" ? issue.path[1] : issue.path[0] ?? "form");
      fieldErrors[field] ??= issue.message;
    }
    return sellerResponse({ error: "Check the application details and try again.", fieldErrors }, 400);
  }
  return sellerResponse({ error: "We could not complete this request. Please try again." }, 500);
}

export async function readSellerBody(request: Request): Promise<unknown> {
  if (!trustedRequestOrigin(request)) {
    throw new SellerApplicationError(403, "This request must come from Cartiva.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new SellerApplicationError(415, "Send the application as JSON.");
  }
  const maxBytes = 16_384;
  if (Number(request.headers.get("content-length")) > maxBytes) throw new SellerApplicationError(413, "The application is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new SellerApplicationError(400, "Send a valid application.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new SellerApplicationError(413, "The application is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new SellerApplicationError(400, "Send a valid application."); }
}
