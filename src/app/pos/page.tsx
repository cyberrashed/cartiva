import type { Metadata } from "next";
import { PosRegister } from "@/components/operations";
import { requirePermission } from "@/server/access";
import { getStorefrontCatalog } from "@/server/catalog-cache";
import "../operations.css";

export const metadata: Metadata = { title: "Point of sale" };
export const instant = false;

export default async function PosPage() {
  await requirePermission("pos:use", "/pos");
  return <PosRegister catalog={await getStorefrontCatalog()} />;
}
