import { MemberAccount } from "@/components/member-account";
import { requireSession } from "@/server/access";
import { hasPermission, type Permission } from "@/lib/permissions";
import { listCustomerOrders } from "@/server/orders";
import { getOwnSellerApplication, getOwnSellerStore } from "@/server/seller-applications";
import "@/app/identity.css";
import "@/app/orders.css";

export const metadata = { title: "My account" };
export const instant = false;

export default async function AccountPage() {
  const { user } = await requireSession();
  const workspaces: { permission: Permission; href: string; label: string }[] = [
    { permission: "admin:view", href: "/admin", label: "Store overview" },
    { permission: "orders:manage", href: "/admin/orders", label: "Orders" },
    { permission: "checkout:manage", href: "/admin/shipping", label: "Shipping" },
    { permission: "checkout:manage", href: "/admin/coupons", label: "Discount codes" },
    { permission: "catalog:manage", href: "/admin/products", label: "Product editor" },
    { permission: "content:manage", href: "/admin/content", label: "Store content" },
    { permission: "vendors:review", href: "/admin/seller-applications", label: "Seller applications" },
    { permission: "vendor:view", href: "/vendor", label: "Seller workspace" },
    { permission: "pos:use", href: "/pos", label: "Point of sale" },
  ];
  const [application, orders] = await Promise.all([
    user.role === "customer" ? getOwnSellerApplication(user.id) : null,
    listCustomerOrders(user.id),
  ]);
  const workspaceLinks = workspaces.filter(({ permission }) => hasPermission(user.role, permission));
  if (!hasPermission(user.role, "vendor:view") && await getOwnSellerStore(user.id)) {
    workspaceLinks.push({ permission: "vendor:view", href: "/vendor", label: "Seller workspace" });
  }
  return <MemberAccount name={user.name} email={user.email} role={user.role ?? "Unassigned"} sellerStatus={application?.status} workspaceLinks={workspaceLinks} orders={orders} />;
}
