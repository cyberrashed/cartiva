"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { money } from "@/lib/cart";
import type { CheckoutStatusDTO } from "@/lib/checkout";
import { finishCheckoutSession } from "@/lib/checkout-session";
import { useStore } from "./store-provider";
import { Icon } from "./icon";
import "@/app/purchase-variants.css";
import "@/app/orders.css";

type View =
  | { kind: "checking" }
  | { kind: "order"; order: CheckoutStatusDTO; stillChecking: boolean }
  | { kind: "missing" }
  | { kind: "offline" };

const POLL_MS = 2_000;
const MAX_POLLS = 15;

/**
 * Stripe returns the customer here with the session id. The page never assumes
 * success from the redirect: it asks Cartiva, which confirms with Stripe.
 */
export function CheckoutComplete() {
  const sessionId = useSearchParams().get("session_id") ?? "";
  const { clearCart } = useStore();
  const [view, setView] = useState<View>(sessionId ? { kind: "checking" } : { kind: "missing" });
  const finished = useRef(false);
  // The bag is emptied once, only after Cartiva has confirmed the payment.
  const onPaid = useEffectEvent(() => {
    if (finished.current) return;
    finished.current = true;
    finishCheckoutSession();
    clearCart();
  });

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check(poll: number) {
      try {
        const response = await fetch(`/api/checkout/status?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        if (cancelled) return;
        if (response.status === 404) { setView({ kind: "missing" }); return; }
        if (!response.ok) throw new Error(String(response.status));
        const order = await response.json() as CheckoutStatusDTO;
        if (cancelled) return;
        const waiting = order.paymentStatus === "awaiting" && poll < MAX_POLLS;
        setView({ kind: "order", order, stillChecking: waiting });
        if (order.paymentStatus === "paid") onPaid();
        if (waiting) timer = setTimeout(() => check(poll + 1), POLL_MS);
      } catch {
        if (cancelled) return;
        if (poll < 3) timer = setTimeout(() => check(poll + 1), POLL_MS);
        else setView({ kind: "offline" });
      }
    }
    check(0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sessionId]);

  if (view.kind === "checking") return <main id="main" className="page-frame confirmation-page" aria-busy="true"><h1>One moment.</h1><p role="status">Confirming your payment with Stripe…</p></main>;
  if (view.kind === "missing") return <main id="main" className="page-frame confirmation-page"><h1>We couldn&apos;t find this checkout.</h1><p>If you paid, your order is still safe. Check your account, or start again from your bag.</p><div className="confirmation-actions"><Link className="button primary" href="/cart">Go to your bag</Link><Link className="text-link" href="/account">Your account <Icon name="arrow" /></Link></div></main>;
  if (view.kind === "offline") return <main id="main" className="page-frame confirmation-page"><h1>We couldn&apos;t confirm just now.</h1><p>Your payment may still be processing. Refresh this page in a minute; you won&apos;t be charged twice.</p></main>;

  const { order, stillChecking } = view;
  const paid = order.paymentStatus === "paid";
  const ended = order.status === "canceled";
  return <main id="main" className="page-frame confirmation-page">
    {paid && <span className="confirmation-icon"><Icon name="check" size={36} /></span>}
    <h1>{paid ? "Thank you. It's ordered." : ended ? "This checkout has ended." : "Almost there."}</h1>
    <p role="status">{paid ? `Stripe confirmed your payment. Your order number is ${order.number}.`
      : ended ? "The payment window closed before a payment was made. Nothing was charged, and the held pieces went back on the shelf."
      : stillChecking ? "Stripe is still confirming your payment. This page updates on its own." : "Your payment is still being confirmed. Refresh this page in a minute; you won't be charged twice."}</p>
    <div className="demo-banner">Sandbox payment · No real money moved. Email confirmations are not connected yet, so keep your order number.</div>
    <div className="receipt"><div className="receipt-heading"><h2>{order.number}</h2><span>{paid ? "Paid" : ended ? "Not paid" : "Awaiting confirmation"}</span></div>
      {order.lines.map(line => <div className="receipt-item order-receipt-line" key={line.sku}><span className="order-receipt-photo">{line.imageSrc ? <Image src={line.imageSrc} alt="" width={56} height={64} /> : null}</span><div className="purchase-item-copy"><span>{line.productName} × {line.quantity}</span><p className="purchase-variant-meta">{line.variantLabel}</p><p className="purchase-sku">SKU: {line.sku}</p></div><span>{money(line.lineTotalCents)}</span></div>)}
      <div className="receipt-item"><span>Subtotal</span><span>{money(order.subtotalCents)}</span></div>
      {order.discountCents > 0 && <div className="receipt-item"><span>Discount{order.couponCode ? ` (${order.couponCode})` : ""}</span><span>−{money(order.discountCents)}</span></div>}
      <div className="receipt-item"><span>{order.shippingMethod?.name ?? "Delivery"}</span><span>{order.shippingCents === 0 ? "Free" : money(order.shippingCents)}</span></div>
      {order.shippingMethod?.kind === "pickup" && <p className="muted">Pickup: {order.shippingMethod.address}{order.shippingMethod.instructions ? `. ${order.shippingMethod.instructions}` : ""}</p>}
      <div className="receipt-item"><span>Sales tax</span><span>Not collected</span></div>
      <div className="receipt-item receipt-total"><span>{paid ? "Total paid" : "Total"}</span><span>{money(order.totalCents)}</span></div>
      <p className="muted">Receipt for {order.email}</p>
    </div>
    <div className="confirmation-actions">{ended ? <Link className="button primary" href="/cart">Back to your bag</Link> : <Link className="button primary" href="/products">Keep exploring</Link>}<Link className="text-link" href="/account">Your orders <Icon name="arrow" /></Link>{paid && <Link className="text-link" href="/track-order">Track this order later <Icon name="arrow" /></Link>}</div>
  </main>;
}
