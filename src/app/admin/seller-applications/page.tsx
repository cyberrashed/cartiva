import type { Metadata } from "next";
import { OperationsShell } from "@/components/operations";
import { SellerApplicationReview } from "@/components/seller-application-review";
import { requirePermission } from "@/server/access";
import { listSellerApplications } from "@/server/seller-applications";
import "../../operations.css";
import "../../seller-review.css";

export const metadata: Metadata = { title: "Seller applications" };
export const instant = false;

export default async function SellerApplicationsPage() {
  const session = await requirePermission("vendors:review", "/admin/seller-applications");
  const applications = await listSellerApplications();

  return (
    <OperationsShell workspace="seller-applications">
      <SellerApplicationReview initialApplications={applications} reviewerEmail={session.user.email} />
    </OperationsShell>
  );
}
