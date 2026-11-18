import Image from "next/image";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { OrderBadges, formatOrderDate } from "@/components/order-badges";
import { money } from "@/lib/cart";
import type { OrderDTO } from "@/lib/checkout";
import type { SellerApplicationStatus } from "@/lib/seller-application";

type MemberAccountProps = {
  name: string;
  email: string;
  role: string;
  sellerStatus?: SellerApplicationStatus;
  workspaceLinks: { href: string; label: string }[];
  orders: OrderDTO[];
};

export function MemberAccount({ name, email, role, sellerStatus, workspaceLinks, orders }: MemberAccountProps) {
  const sellerLabels = { draft: "Continue your draft", submitted: "View your submitted application", changes_requested: "Update your seller application", approved: "View your approved application" };
  return <main id="main" className="identity-page identity-member" data-ui>
    <header className="identity-member-heading"><div><h1>Your account</h1><p className="identity-intro">Signed in as {name}.</p></div><SignOutButton /></header>
    <div className="identity-member-grid">
      <section className="identity-orders" aria-labelledby="identity-orders-title">
        <h2 id="identity-orders-title">Your orders</h2>
        {orders.length ? <div className="order-history">{orders.map(order => <article className="order-history-item" key={order.id}>
          <div className="order-history-head"><div><h3>{order.number}</h3><span>Placed {formatOrderDate(order.placedAt ?? order.createdAt)}</span></div><OrderBadges order={order} /></div>
          <div className="order-history-body"><span className="order-history-photos">{order.lines.slice(0, 3).map(line => line.imageSrc ? <Image key={line.variantId} src={line.imageSrc} alt="" width={44} height={52} /> : null)}</span><p>{order.lines.map(line => `${line.productName} × ${line.quantity}`).join(" · ")}</p><strong>{money(order.totalCents)}</strong></div>
          <Link href={`/account/orders/${order.number}`}>View order {order.number}</Link>
        </article>)}</div> : <div className="identity-orders-empty">
          <h3>No orders yet</h3>
          <p>Orders you place while signed in appear here. Payments run in Stripe&apos;s sandbox, so no real money moves.</p>
          <Link className="identity-primary" href="/products">Browse the collection</Link>
        </div>}
        <div className="identity-sample-link"><p>Explore delivery tracking and returns with sample orders.</p><Link href="/account/sample">View sample orders →</Link></div>
      </section>
      <aside className="identity-member-details" aria-label="Account details">
        <section className="identity-profile"><h2>Account details</h2><dl><div><dt>Name</dt><dd>{name}</dd></div><div><dt>Email address</dt><dd>{email}</dd></div><div><dt>Account role</dt><dd className="identity-role">{role.replaceAll("_", " ")}</dd></div></dl><p className="identity-note">Local preview account. Email verification and recovery are not available yet.</p></section>
        {workspaceLinks.length > 0 && <nav className="identity-workspaces" aria-labelledby="identity-workspace-title"><h2 id="identity-workspace-title">Your workspace</h2>{workspaceLinks.map(link => <Link key={link.href} href={link.href}>{link.label}<span aria-hidden="true">→</span></Link>)}</nav>}
        {role === "customer" && <nav className="identity-workspaces" aria-labelledby="identity-seller-title"><h2 id="identity-seller-title">Selling on Cartiva</h2><Link href={sellerStatus ? "/become-vendor/apply" : "/become-vendor"}>{sellerStatus ? sellerLabels[sellerStatus] : "Become a seller"}<span aria-hidden="true">→</span></Link></nav>}
      </aside>
    </div>
  </main>;
}
