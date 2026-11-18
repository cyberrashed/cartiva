import type { Metadata } from "next";
import Link from "next/link";
import { OperationsShell, VendorOverview } from "@/components/operations";
import { requirePermission, requireSession } from "@/server/access";
import { getOwnSellerStore } from "@/server/seller-applications";
import "../operations.css";
import "../seller-workspace.css";

export const metadata: Metadata = { title: "Seller workspace" };
export const instant = false;

export default async function VendorPage() {
  const { user } = await requireSession("/vendor");
  const store = await getOwnSellerStore(user.id);
  if (!store) {
    await requirePermission("vendor:view", "/vendor");
    if (user.role === "owner" || user.role === "administrator") return <VendorOverview />;
  }
  return <OperationsShell workspace="vendor" connected storeName={store?.name}>
    <div className="seller-workspace" data-ui>
      <header><h1>{store?.name ?? "Your seller workspace"}</h1><p>{store ? "Your application is approved. Your store details are saved to your account." : "There is no store assigned to this account yet."}</p></header>
      {store && <div className="seller-workspace-grid">
        <section aria-labelledby="seller-store-title"><h2 id="seller-store-title">Store details</h2><dl>
          <div><dt>Category</dt><dd>{store.fields.category}</dd></div>
          <div><dt>Contact</dt><dd>{store.fields.contactName}</dd></div>
          <div><dt>Location</dt><dd>{store.fields.city}, {store.fields.state} · United States</dd></div>
          <div><dt>About the store</dt><dd>{store.fields.description}</dd></div>
          {store.fields.website && <div><dt>Website</dt><dd><a href={store.fields.website} target="_blank" rel="noopener noreferrer">{store.fields.website}</a></dd></div>}
        </dl><Link href="/become-vendor/apply">View approved application →</Link></section>
        <section aria-labelledby="seller-selling-title"><h2 id="seller-selling-title">Selling tools</h2><p>Your store is ready for the next setup stage. Product management, orders and payouts are not connected to your store yet.</p><p>This is a local preview. Approval does not publish a storefront or enable payments.</p><Link href="/account">Back to your account →</Link></section>
      </div>}
      {!store && <Link href="/account">Back to your account →</Link>}
    </div>
  </OperationsShell>;
}
