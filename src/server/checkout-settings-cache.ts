import "server-only";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { freeDeliveryHint } from "../lib/checkout-settings";
import { loadShippingSettings } from "./checkout-settings";

const SHIPPING_TAG = "shipping";

/** The bag's free-delivery hint, cached in the static shell and expired when settings change. */
export async function getFreeDeliveryHint() {
  "use cache";
  cacheLife("max");
  cacheTag(SHIPPING_TAG);
  return freeDeliveryHint((await loadShippingSettings()).config);
}

export function invalidateShipping() {
  if (!process.env.NEXT_RUNTIME) return;
  revalidateTag(SHIPPING_TAG, { expire: 0 });
}
