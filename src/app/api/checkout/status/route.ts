import { checkoutStatus } from "@/server/orders";
import { orderErrorResponse, orderResponse } from "@/server/orders-api";

/** The confirmation page's order state. The Stripe session id acts as the receipt token. */
export async function GET(request: Request) {
  // Read the request outside the try block so Next.js can mark this route dynamic.
  const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
  try {
    const status = await checkoutStatus(sessionId);
    return status ? orderResponse(status) : orderResponse({ error: "We couldn't find this checkout." }, 404);
  } catch (error) {
    return orderErrorResponse(error);
  }
}
