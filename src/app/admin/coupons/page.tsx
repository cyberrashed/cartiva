import type { Metadata } from "next";
import { CouponManager } from "@/components/coupon-manager";
import { requirePermission } from "@/server/access";
import { listCoupons } from "@/server/checkout-settings";
import "../../operations.css";
import "../../product-editor.css";
import "../../checkout-settings.css";

export const metadata: Metadata = { title: "Discount codes" };
export const instant = false;

export default async function CouponsPage() {
  await requirePermission("checkout:manage", "/admin/coupons");
  return <CouponManager initialCoupons={await listCoupons()} />;
}
