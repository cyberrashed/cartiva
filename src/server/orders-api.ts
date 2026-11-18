import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fieldErrorsFrom } from "../lib/catalog-admin";
import { trustedClientIp } from "./client-ip";
import { pool } from "./db";
import { readSameOriginJson } from "./json-body";
import { OrderError } from "./orders";

export function orderResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function orderErrorResponse(error: unknown) {
  if (error instanceof OrderError) {
    return orderResponse({ error: error.message, ...(error.problems ? { problems: error.problems } : {}), ...error.extra }, error.status);
  }
  if (error instanceof z.ZodError) {
    return orderResponse({ error: "Check the highlighted details and try again.", fieldErrors: fieldErrorsFrom(error) }, 400);
  }
  console.error("Checkout request failed", error instanceof Error ? error.message : error);
  return orderResponse({ error: "We could not start checkout. Nothing was charged. Please try again." }, 500);
}

/**
 * A database-backed request budget for public endpoints that must not be
 * brute-forced (order lookup). Per visitor where the host supplies a trusted IP
 * (Vercel); locally forwarding headers are not trusted, so the bucket is shared.
 */
export async function withinRequestBudget(request: Request, name: string, max: number, windowMs: number): Promise<boolean> {
  const ip = trustedClientIp(request.headers);
  const key = ip ? `${name}:${ip}` : name;
  const now = Date.now();
  const { rows } = await pool.query<{ count: number }>(
    `INSERT INTO rate_limit (id, key, count, last_request) VALUES ($1, $2, 1, $3)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limit.last_request < $3 - $4 THEN 1 ELSE rate_limit.count + 1 END,
       last_request = CASE WHEN rate_limit.last_request < $3 - $4 THEN $3 ELSE rate_limit.last_request END
     RETURNING count`,
    [randomUUID(), `cartiva:${key}`, now, windowMs],
  );
  return rows[0].count <= max;
}

export function readCheckoutBody(request: Request): Promise<unknown> {
  return readSameOriginJson(request, 16_384, {
    forbidden: "This request must come from Cartiva.",
    type: "Send the checkout as JSON.",
    tooLarge: "This checkout is too large.",
    invalid: "Send a valid checkout.",
  }, (status, message) => new OrderError(status, message));
}
