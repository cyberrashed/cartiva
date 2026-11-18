import type { Metadata } from "next";
import { ShippingEditor } from "@/components/shipping-editor";
import { requirePermission } from "@/server/access";
import { loadShippingSettings } from "@/server/checkout-settings";
import "../../operations.css";
import "../../product-editor.css";
import "../../checkout-settings.css";

export const metadata: Metadata = { title: "Shipping" };
export const instant = false;

export default async function ShippingPage() {
  await requirePermission("checkout:manage", "/admin/shipping");
  return <ShippingEditor initial={await loadShippingSettings()} />;
}
