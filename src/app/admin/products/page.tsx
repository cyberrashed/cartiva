import type { Metadata } from "next";
import { ProductEditor } from "@/components/product-editor";
import { requirePermission } from "@/server/access";
import { listAdminProducts } from "@/server/catalog";
import "../../operations.css";
import "../../product-editor.css";

export const metadata: Metadata = { title: "Product editor" };
export const instant = false;

export default async function ProductEditorPage() {
  await requirePermission("catalog:manage", "/admin/products");
  return <ProductEditor initialProducts={await listAdminProducts()} />;
}
