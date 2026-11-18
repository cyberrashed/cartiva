import { couponInputSchema } from "@/lib/checkout-settings";
import { listCoupons, saveCoupon } from "@/server/checkout-settings";
import { readSettingsBody, requireCheckoutManager, settingsErrorResponse, settingsResponse } from "@/server/settings-api";

export async function GET(request: Request) {
  try {
    await requireCheckoutManager(request);
    return settingsResponse(await listCoupons());
  } catch (error) {
    return settingsErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireCheckoutManager(request);
    const input = couponInputSchema.parse(await readSettingsBody(request));
    return settingsResponse(await saveCoupon(actor.id, undefined, input), 201);
  } catch (error) {
    return settingsErrorResponse(error);
  }
}
