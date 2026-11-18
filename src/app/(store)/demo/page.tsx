import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoNotice } from "@/components/demo-notice";
import { demoMode } from "@/server/demo";
import "@/app/orders.css";

export const metadata = { title: "Explore the demo" };

const cards = [
  { role: "shopper", title: "Shop as a customer", button: "Enter as a shopper", points: ["Browse, filter and pick variants", "Try code WELCOME15 (15% off from $50) or FREESHIP", "Pay on Stripe's test page with 4242 4242 4242 4242", "See your orders in your account"] },
  { role: "admin", title: "Run the store", button: "Enter as the store admin", points: ["Orders with payment, ledger and stock history", "Edit products, prices, variants and stock", "Set shipping zones, pickup and discount codes", "Review seller applications"] },
];

export default function DemoPage() {
  if (!demoMode()) notFound();
  return <main id="main" className="page-frame confirmation-page demo-page">
    <h1>Explore Cartiva.</h1>
    <p>A full-stack marketplace demo: a real catalog, orders, stock holds and payments in Stripe&apos;s sandbox, so no real money moves.</p>
    <Suspense><DemoNotice /></Suspense>
    <div className="demo-cards">{cards.map(card => <form key={card.role} className="demo-card" method="post" action="/api/demo/session">
      <h2>{card.title}</h2>
      <ul>{card.points.map(point => <li key={point}>{point}</li>)}</ul>
      <input type="hidden" name="role" value={card.role} />
      <button type="submit" className="button primary">{card.button}</button>
    </form>)}</div>
    <p className="small-note">Or <Link href="/products">browse as a guest</Link>; guests can check out too and find their order later with its number.</p>
    <div className="demo-banner">Shared demo accounts: anyone can open them, so use made-up names and addresses. Contact details are partly hidden in the demo, and the store resets every day (sample catalog, stock, shipping and codes; orders older than a day are deleted).</div>
    <section className="demo-cards-note" aria-labelledby="demo-cards-title"><h2 id="demo-cards-title">Stripe test cards</h2>
      <dl className="order-totals"><div><dt>Paid</dt><dd>4242 4242 4242 4242</dd></div><div><dt>Declined</dt><dd>4000 0000 0000 9995</dd></div><div><dt>Asks for 3D Secure</dt><dd>4000 0025 0000 3155</dd></div></dl>
      <p className="small-note">Any future expiry date and any CVC.</p>
    </section>
  </main>;
}
