import type { Metadata } from "next";
import { AdminOrders } from "@/components/admin-orders";
import { requirePermission } from "@/server/access";
import { demoMode, redactOrderForDemo } from "@/server/demo";
import { listAdminOrders } from "@/server/orders";
import "../../operations.css";

export const metadata: Metadata = { title: "Orders" };
export const instant = false;

export default async function AdminOrdersPage() {
  await requirePermission("orders:manage", "/admin/orders");
  const orders = await listAdminOrders();
  return <AdminOrders orders={demoMode() ? orders.map(redactOrderForDemo) : orders} />;
}
