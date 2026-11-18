import { checkoutInputSchema } from "@/lib/checkout";
import { trustedRequestOrigin } from "@/server/app-origin";
import { auth } from "@/server/auth";
import { startCheckout } from "@/server/orders";
import { orderErrorResponse, orderResponse, readCheckoutBody } from "@/server/orders-api";

/** Creates (or resumes) the order and stock hold, then returns the Stripe payment page. */
export async function POST(request: Request) {
  try {
    const input = checkoutInputSchema.parse(await readCheckoutBody(request));
    const session = await auth.api.getSession({ headers: request.headers });
    // readCheckoutBody has already rejected any other origin.
    return orderResponse(await startCheckout(input, session?.user.id ?? null, trustedRequestOrigin(request)!));
  } catch (error) {
    return orderErrorResponse(error);
  }
}
