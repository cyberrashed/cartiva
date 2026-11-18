import { couponInputSchema } from "@/lib/checkout-settings";
import { saveCoupon } from "@/server/checkout-settings";
import { readSettingsBody, requireCheckoutManager, settingsErrorResponse, settingsResponse } from "@/server/settings-api";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireCheckoutManager(request);
    const { id } = await params;
    const input = couponInputSchema.parse(await readSettingsBody(request));
    return settingsResponse(await saveCoupon(actor.id, id, input));
  } catch (error) {
    return settingsErrorResponse(error);
  }
}
