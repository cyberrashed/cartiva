"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { money } from "@/lib/cart";
import { fulfillmentStatusLabels, paymentStatusLabels, type OrderLookupDTO } from "@/lib/checkout";
import { deliveryWindow } from "@/lib/checkout-settings";
import { useHydrated } from "@/lib/use-hydrated";
import "@/app/purchase-variants.css";
import "@/app/orders.css";

const day = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

/** The result stays in page state only; nothing is stored in the browser. */
export function OrderLookup() {
  const hydrated = useHydrated();
  const [number, setNumber] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderLookupDTO | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setOrder(null);
    try {
      const response = await fetch("/api/orders/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number, email }) });
      const body = await response.json().catch(() => ({}));
      if (response.ok) setOrder(body as OrderLookupDTO);
      else setError(body.fieldErrors?.number ?? body.fieldErrors?.email ?? body.error ?? "We couldn't look up that order.");
    } catch {
      setError("We couldn't reach Cartiva. Check your connection and try again.");
    }
    setPending(false);
    requestAnimationFrame(() => resultRef.current?.focus());
  }

  const method = order?.shippingMethod;
  return <main id="main" className="page-frame confirmation-page">
    <h1>Find your order.</h1>
    <p>Enter the order number from your confirmation and the email you used at checkout.</p>
    <form className="checkout-form order-lookup-form" method="post" onSubmit={submit}>
      <div className="form-row"><label>Order number<input name="number" required placeholder="CV-2001" autoComplete="off" value={number} onChange={event => setNumber(event.target.value)} /></label>
        <label>Email address<input name="email" type="email" required autoComplete="email" placeholder="alex@example.com" value={email} onChange={event => setEmail(event.target.value)} /></label></div>
      <button type="submit" className="button primary" disabled={!hydrated || pending}>{pending ? "Looking…" : "Find order"}</button>
    </form>
    <div ref={resultRef} tabIndex={-1} className="order-lookup-result">
      {error && <p className="checkout-alert" role="alert">{error}</p>}
      {order && <div className="receipt" role="status">
        <div className="receipt-heading"><h2>{order.number}</h2><span>{paymentStatusLabels[order.paymentStatus]} · {fulfillmentStatusLabels[order.fulfillmentStatus]}</span></div>
        <p className="muted">{order.placedAt ? `Placed ${day.format(new Date(order.placedAt))}` : ""} · {method?.kind === "pickup" ? `Pickup at ${order.destination}` : `Shipping to ${order.destination}`}{method && method.kind === "delivery" && deliveryWindow(method) ? ` · ${method.name}, ${deliveryWindow(method)}` : ""}</p>
        {order.lines.map(line => <div className="receipt-item order-receipt-line" key={line.sku}><span className="order-receipt-photo">{line.imageSrc ? <Image src={line.imageSrc} alt="" width={56} height={64} /> : null}</span><div className="purchase-item-copy"><span>{line.productName} × {line.quantity}</span><p className="purchase-variant-meta">{line.variantLabel}</p></div><span>{money(line.lineTotalCents)}</span></div>)}
        {order.discountCents > 0 && <div className="receipt-item"><span>Discount{order.couponCode ? ` (${order.couponCode})` : ""}</span><span>−{money(order.discountCents)}</span></div>}
        <div className="receipt-item"><span>{method?.name ?? "Delivery"}</span><span>{order.shippingCents === 0 ? "Free" : money(order.shippingCents)}</span></div>
        <div className="receipt-item receipt-total"><span>Total paid</span><span>{money(order.totalCents)}</span></div>
        <p className="muted">Tracking numbers appear here once shipping is connected.</p>
      </div>}
    </div>
    <p className="small-note">Signed in when you ordered? Your orders are also in <Link href="/account">your account</Link>.</p>
  </main>;
}
