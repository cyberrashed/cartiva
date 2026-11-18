import type { Metadata } from "next";
import { AdminOverview } from "@/components/operations";
import { requirePermission } from "@/server/access";
import { getStorefrontCatalog } from "@/server/catalog-cache";
import "../operations.css";

export const metadata: Metadata = { title: "Store overview" };
export const instant = false;

export default async function AdminPage() {
  await requirePermission("admin:view", "/admin");
  return <AdminOverview catalog={await getStorefrontCatalog()} />;
}
