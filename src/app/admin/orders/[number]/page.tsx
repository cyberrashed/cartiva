import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OperationsShell } from "@/components/operations";
import { money } from "@/lib/cart";
import { fulfillmentStatusLabels, orderStatusLabels, paymentStatusLabels } from "@/lib/checkout";
import { requirePermission } from "@/server/access";
import { demoMode, redactOrderForDemo } from "@/server/demo";
import { getAdminOrder } from "@/server/orders";
import "../../../operations.css";
import "../../../admin-orders.css";

export const metadata: Metadata = { title: "Order details" };
export const instant = false;

const accountNames: Record<string, string> = {
  stripe_receivable: "Stripe balance (receivable)",
  sales_revenue: "Sales revenue",
  sales_discounts: "Sales discounts (contra-revenue)",
  shipping_revenue: "Delivery revenue",
  sales_tax_payable: "Sales tax payable",
  payment_processing_fees: "Payment processing fees",
};
const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default async function AdminOrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  await requirePermission("orders:manage", `/admin/orders/${number}`);
  const found = /^CV-\d{1,12}$/.test(number) ? await getAdminOrder(number) : null;
  if (!found) notFound();
  const order = demoMode() ? redactOrderForDemo(found) : found;
  return <OperationsShell workspace="orders" connected>
    <Link className="ops-text-button order-admin-back" href="/admin/orders">← All orders</Link>
    <div className="ops-page-heading"><div><h1>Order {order.number}</h1><p>Created {when.format(new Date(order.createdAt))}{order.placedAt ? ` · Paid ${when.format(new Date(order.placedAt))}` : ""}{order.canceledAt ? ` · Canceled ${when.format(new Date(order.canceledAt))}` : ""}</p></div>
      <span className="order-admin-states"><span>{orderStatusLabels[order.status]}</span><span>{paymentStatusLabels[order.paymentStatus]}</span>{order.status === "placed" && <span>{fulfillmentStatusLabels[order.fulfillmentStatus]}</span>}</span></div>
    {order.reviewReason && <p className="order-admin-review" role="note"><strong>Needs review.</strong> {order.reviewReason}</p>}
    <div className="order-admin-grid">
      <section className="ops-panel" aria-labelledby="admin-order-items"><div className="ops-section-heading"><div><h2 id="admin-order-items">Items</h2><p>Name, SKU and price as sold; later catalog edits don&apos;t change them.</p></div></div>
        <div className="ops-dialog-lines">{order.lines.map(line => <div key={line.variantId}>{line.imageSrc ? <Image src={line.imageSrc} alt="" width={60} height={66} /> : null}<div><strong>{line.productName}</strong><span>{line.variantLabel} · SKU {line.sku} · {line.quantity} × {money(line.unitPriceCents)}</span></div><strong>{money(line.lineTotalCents)}</strong></div>)}</div>
        <dl className="order-admin-totals"><div><dt>Subtotal</dt><dd>{money(order.subtotalCents)}</dd></div>{order.discountCents > 0 && <div><dt>Discount{order.couponCode ? ` (${order.couponCode})` : ""}</dt><dd>−{money(order.discountCents)}</dd></div>}<div><dt>{order.shippingMethod?.name ?? "Delivery"}</dt><dd>{money(order.shippingCents)}</dd></div><div><dt>Sales tax</dt><dd>{money(order.taxCents)} · not collected</dd></div><div className="is-total"><dt>Total</dt><dd>{money(order.totalCents)}</dd></div></dl>
      </section>
      <aside className="order-admin-aside">
        <section className="ops-panel" aria-labelledby="admin-order-customer"><h2 id="admin-order-customer">Customer and delivery</h2><address>{order.shipping.name}<br />{order.shipping.address}<br />{order.shipping.city}, {order.shipping.state} {order.shipping.zip}<br />United States</address><p>{order.email}</p>
          {order.shippingMethod && <p>{order.shippingMethod.kind === "pickup" ? `Pickup · ${order.shippingMethod.name}, ${order.shippingMethod.address}` : order.shippingMethod.name}</p>}</section>
        <section className="ops-panel" aria-labelledby="admin-order-payment"><h2 id="admin-order-payment">Payment</h2>
          <p>{order.paymentStatus === "paid" ? "Card payment confirmed by Stripe (sandbox)." : order.paymentStatus === "awaiting" ? "Stock is held while the customer pays on Stripe." : "No payment was taken."}</p>
          {order.stripePaymentIntentId && <a className="ops-text-button" href={`https://dashboard.stripe.com/test/payments/${order.stripePaymentIntentId}`} target="_blank" rel="noreferrer">Open in Stripe Dashboard ↗</a>}
        </section>
      </aside>
    </div>
    <section className="ops-panel order-admin-section" aria-labelledby="admin-order-ledger"><div className="ops-section-heading"><div><h2 id="admin-order-ledger">Ledger</h2><p>Double-entry journals posted from Stripe-confirmed amounts. Each journal balances.</p></div></div>
      {order.journals.length ? order.journals.map(journal => <div className="ops-table-wrap" key={`${journal.kind}-${journal.createdAt}`}><table><caption>{journal.memo} · {when.format(new Date(journal.createdAt))}</caption><thead><tr><th>Account</th><th className="ops-number">Debit</th><th className="ops-number">Credit</th></tr></thead><tbody>{journal.lines.map(line => <tr key={line.account}><td>{accountNames[line.account] ?? line.account}</td><td className="ops-number">{line.debitCents ? money(line.debitCents) : ""}</td><td className="ops-number">{line.creditCents ? money(line.creditCents) : ""}</td></tr>)}</tbody></table></div>) : <p className="ops-muted">Nothing is posted until Stripe confirms a payment.</p>}
    </section>
    <section className="ops-panel order-admin-section" aria-labelledby="admin-order-stock"><div className="ops-section-heading"><div><h2 id="admin-order-stock">Stock movements</h2><p>On-hand changes caused by this order.</p></div></div>
      {order.movements.length ? <div className="ops-table-wrap"><table><thead><tr><th>SKU</th><th className="ops-number">Change</th><th className="ops-number">On hand after</th><th>When</th></tr></thead><tbody>{order.movements.map(movement => <tr key={`${movement.sku}-${movement.createdAt}`}><td>{movement.sku}</td><td className="ops-number">{movement.delta}</td><td className="ops-number">{movement.balanceAfter}</td><td>{when.format(new Date(movement.createdAt))}</td></tr>)}</tbody></table></div>
        : <p className="ops-muted">{order.status === "pending_payment" ? "Stock is reserved, not yet taken." : "No stock was taken for this order."}</p>}
    </section>
  </OperationsShell>;
}
