import { quoteInputSchema } from "@/lib/checkout";
import { quoteCheckout } from "@/server/orders";
import { orderErrorResponse, orderResponse, readCheckoutBody } from "@/server/orders-api";

/** Server-calculated totals, delivery options and code status for the review step. */
export async function POST(request: Request) {
  try {
    return orderResponse(await quoteCheckout(quoteInputSchema.parse(await readCheckoutBody(request))));
  } catch (error) {
    return orderErrorResponse(error);
  }
}
