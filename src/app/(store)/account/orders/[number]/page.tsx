import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderBadges, formatOrderDate } from "@/components/order-badges";
import { money } from "@/lib/cart";
import { deliveryWindow } from "@/lib/checkout-settings";
import { requireSession } from "@/server/access";
import { demoMode, isDemoAccount, redactOrderForDemo } from "@/server/demo";
import { getCustomerOrder } from "@/server/orders";
import "@/app/identity.css";
import "@/app/orders.css";

export const metadata = { title: "Order details", robots: { index: false, follow: false } };
export const instant = false;

export default async function CustomerOrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const { user } = await requireSession(`/account/orders/${number}`);
  // Only the signed-in owner can open an order; others get the same not-found page.
  const found = /^CV-\d{1,12}$/.test(number) ? await getCustomerOrder(user.id, number) : null;
  if (!found) notFound();
  // The demo shopper account is shared by every visitor, so its orders hide contact details.
  const order = demoMode() && isDemoAccount(user.email) ? redactOrderForDemo(found) : found;
  return <main id="main" className="identity-page" data-ui>
    <Link className="identity-back" href="/account">← Your account</Link>
    <header className="identity-member-heading"><div><h1>Order {order.number}</h1><p className="identity-intro">Placed {formatOrderDate(order.placedAt ?? order.createdAt)}</p></div><OrderBadges order={order} /></header>
    <div className="order-detail">
      <section className="order-detail-panel" aria-labelledby="order-items-title"><h2 id="order-items-title">Your items</h2>
        <div className="order-detail-lines">{order.lines.map(line => <div className="order-detail-line" key={line.variantId}>{line.imageSrc ? <Image src={line.imageSrc} alt="" width={64} height={76} /> : null}<div><b>{line.productName}</b><span>{line.variantLabel} · Qty {line.quantity} · {money(line.unitPriceCents)} each</span><span>SKU {line.sku}</span></div><strong>{money(line.lineTotalCents)}</strong></div>)}</div>
        <dl className="order-totals"><div><dt>Subtotal</dt><dd>{money(order.subtotalCents)}</dd></div>{order.discountCents > 0 && <div><dt>Discount{order.couponCode ? ` (${order.couponCode})` : ""}</dt><dd>−{money(order.discountCents)}</dd></div>}<div><dt>{order.shippingMethod?.name ?? "Delivery"}</dt><dd>{order.shippingCents === 0 ? "Free" : money(order.shippingCents)}</dd></div><div><dt>Sales tax</dt><dd>Not collected</dd></div><div className="is-total"><dt>Total paid</dt><dd>{money(order.totalCents)}</dd></div></dl>
      </section>
      <aside className="order-detail-aside">
        <section className="order-detail-panel" aria-labelledby="order-delivery-title"><h2 id="order-delivery-title">{order.shippingMethod?.kind === "pickup" ? "Pickup" : "Delivery"}</h2>
          {order.shippingMethod?.kind === "pickup"
            ? <><address>{order.shippingMethod.name}<br />{order.shippingMethod.address}</address>{order.shippingMethod.instructions && <p>{order.shippingMethod.instructions}</p>}</>
            : <><address>{order.shipping.name}<br />{order.shipping.address}<br />{order.shipping.city}, {order.shipping.state} {order.shipping.zip}<br />United States</address>{order.shippingMethod && <p>{order.shippingMethod.name}{deliveryWindow(order.shippingMethod) ? ` · ${deliveryWindow(order.shippingMethod)}` : ""}</p>}</>}
        </section>
        <section className="order-detail-panel" aria-labelledby="order-payment-title"><h2 id="order-payment-title">Payment</h2><p>Paid by card through Stripe&apos;s sandbox. No real money moved. Receipt email: {order.email}.</p><p>Shipping updates appear here once tracking is connected.</p></section>
      </aside>
    </div>
  </main>;
}
