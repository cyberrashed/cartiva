import { z } from "zod";
import { shippingConfigSchema } from "@/lib/checkout-settings";
import { loadShippingSettings, saveShippingSettings } from "@/server/checkout-settings";
import { invalidateShipping } from "@/server/checkout-settings-cache";
import { readSettingsBody, requireCheckoutManager, settingsErrorResponse, settingsResponse } from "@/server/settings-api";

const updateSchema = z.strictObject({ version: z.number().int().nonnegative(), config: shippingConfigSchema });

export async function GET(request: Request) {
  try {
    await requireCheckoutManager(request);
    return settingsResponse(await loadShippingSettings());
  } catch (error) {
    return settingsErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireCheckoutManager(request);
    const { version, config } = updateSchema.parse(await readSettingsBody(request));
    const saved = await saveShippingSettings(actor.id, version, config);
    invalidateShipping();
    return settingsResponse(saved);
  } catch (error) {
    return settingsErrorResponse(error);
  }
}
