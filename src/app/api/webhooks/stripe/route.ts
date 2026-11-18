import { handleStripeEvent } from "@/server/orders";
import { verifyStripeWebhook } from "@/server/payment-gateway";

const MAX_BYTES = 512 * 1024;
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Stripe webhook endpoint. The signature is checked against the raw body before
 * anything is parsed or stored; a failed handler returns 500 so Stripe retries.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return reply({ error: "Webhooks are not configured." }, 503);
  const signature = request.headers.get("stripe-signature");
  if (!signature) return reply({ error: "Missing signature." }, 400);
  if (Number(request.headers.get("content-length")) > MAX_BYTES) return reply({ error: "Payload too large." }, 413);
  const payload = await request.text();
  if (payload.length > MAX_BYTES) return reply({ error: "Payload too large." }, 413);
  let event;
  try {
    event = verifyStripeWebhook(payload, signature, secret);
  } catch {
    return reply({ error: "Invalid signature." }, 400);
  }
  try {
    return reply({ received: true, outcome: await handleStripeEvent(event) });
  } catch (error) {
    console.error("Stripe webhook failed", event.id, event.type, error instanceof Error ? error.message : error);
    return reply({ error: "Processing failed." }, 500);
  }
}
