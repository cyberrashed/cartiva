import { orderLookupSchema } from "@/lib/checkout";
import { lookupOrder } from "@/server/orders";
import { orderErrorResponse, orderResponse, readCheckoutBody, withinRequestBudget } from "@/server/orders-api";

const NOT_FOUND = "We couldn't find a placed order with that number and email.";

/** Guest order lookup by number and checkout email, with a shared request budget. */
export async function POST(request: Request) {
  try {
    const { number, email } = orderLookupSchema.parse(await readCheckoutBody(request));
    if (!await withinRequestBudget(request, "order-lookup", 30, 60_000)) {
      return orderResponse({ error: "Too many lookups right now. Please wait a minute and try again." }, 429);
    }
    const order = await lookupOrder(number, email);
    return order ? orderResponse(order) : orderResponse({ error: NOT_FOUND }, 404);
  } catch (error) {
    return orderErrorResponse(error);
  }
}
