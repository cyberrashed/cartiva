import type { Metadata } from "next";
import { ContentEditor } from "@/components/content-editor";
import { requirePermission } from "@/server/access";
import "../../operations.css";
import "../../content-editor.css";

export const metadata: Metadata = { title: "Storefront content" };
export const instant = false;

export default async function ContentPage() {
  await requirePermission("content:manage", "/admin/content");
  return <ContentEditor />;
}
