"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { getVariant, getVariantLabel, getVariantMedia } from "@/lib/catalog";
import { money, subtotal } from "@/lib/cart";
import { RESERVATION_MINUTES, usStates, type CheckoutProblem, type CheckoutStartResult, type QuoteDTO } from "@/lib/checkout";
import { deliveryWindow } from "@/lib/checkout-settings";
import { checkoutKey, finishCheckoutSession, storeChoices, storeDelivery, storedChoices, storedDelivery, type Choices, type Delivery } from "@/lib/checkout-session";
import { useHydrated } from "@/lib/use-hydrated";
import { useStore } from "./store-provider";
import { Icon } from "./icon";
import "@/app/purchase-variants.css";
import "@/app/orders.css";

type Failure = { message: string; problems?: CheckoutProblem[]; fieldErrors?: Record<string, string> };
type FieldName = keyof Delivery;
type ErrorBody = { error?: string; problems?: CheckoutProblem[]; fieldErrors?: Record<string, string>; code?: "coupon" | "shipping" | "total_changed" };

const fields: { name: FieldName; label: string; autoComplete: string; placeholder?: string }[] = [
  { name: "email", label: "Email address", autoComplete: "email", placeholder: "alex@example.com" },
  { name: "name", label: "Full name", autoComplete: "shipping name", placeholder: "Alex Morgan" },
  { name: "address", label: "Street address", autoComplete: "shipping street-address", placeholder: "123 Sample Street" },
];

export function CheckoutView({ publicDemo = false }: { publicDemo?: boolean }) {
  const { lines } = useStore();
  const canceled = useSearchParams().get("payment") === "canceled";
  const [placed, setPlaced] = useState<string | null>(null);
  if (placed) return <main id="main" className="page-frame confirmation-page"><span className="confirmation-icon"><Icon name="check" size={36} /></span><h1>Already ordered.</h1><p>Order {placed} was paid in this browser tab, so nothing new was charged.</p><Link className="button primary" href="/account">View your orders</Link></main>;
  if (!lines.length) return <main id="main" className="page-frame"><div className="empty-state"><h1>Your bag is empty.</h1><p>Choose a find before checking out.</p><Link className="button primary" href="/products">Explore the collection</Link></div></main>;
  return <CheckoutFlow canceled={canceled} publicDemo={publicDemo} onPlaced={setPlaced} />;
}

/** Mounted only in the browser (the bag is browser-local), so stored details can seed the form. */
function CheckoutFlow({ canceled, publicDemo, onPlaced }: { canceled: boolean; publicDemo: boolean; onPlaced: (number: string) => void }) {
  const { lines, products, clearCart } = useStore();
  const router = useRouter();
  const hydrated = useHydrated();
  const [stage, setStage] = useState<"details" | "review">("details");
  const [delivery, setDelivery] = useState<Delivery>(storedDelivery);
  const [choices, setChoices] = useState<Choices>(storedChoices);
  const [codeInput, setCodeInput] = useState(() => storedChoices().couponCode ?? "");
  const [codeMessage, setCodeMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [quote, setQuote] = useState<QuoteDTO | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  function update(field: FieldName, value: string) {
    const next = { ...delivery, [field]: value };
    setDelivery(next);
    storeDelivery(next);
  }

  function remember(next: Choices) {
    setChoices(next);
    storeChoices(next);
  }

  function itemName(variantId: string) {
    for (const product of products) {
      const variant = getVariant(product, variantId);
      if (variant) return `${product.name} · ${getVariantLabel(variant)}`;
    }
    return "An item";
  }

  function focusAlert() {
    requestAnimationFrame(() => alertRef.current?.focus());
  }

  async function refreshQuote(next: Choices): Promise<QuoteDTO | null> {
    setQuoting(true);
    try {
      const response = await fetch("/api/checkout/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines: lines.map(line => ({ variantId: line.variantId, quantity: line.quantity })), state: delivery.state, couponCode: next.couponCode, shippingMethodId: next.shippingMethodId }),
      });
      const body = await response.json().catch(() => ({})) as QuoteDTO & ErrorBody;
      if (!response.ok) {
        setFailure({ message: body.error ?? "We couldn't update your totals. Please try again.", fieldErrors: body.fieldErrors });
        if (body.fieldErrors) setStage("details");
        return null;
      }
      setQuote(body);
      if (body.coupon) setCodeMessage({ ok: body.coupon.ok, text: body.coupon.message });
      remember({ shippingMethodId: body.selectedMethodId, couponCode: body.coupon?.ok ? body.coupon.code : null });
      if (body.problems.length) {
        router.refresh();
        setFailure({ message: "Some items in your bag changed. Review your bag before paying.", problems: body.problems });
        focusAlert();
      }
      return body;
    } catch {
      setFailure({ message: "We couldn't reach Cartiva. Check your connection and try again." });
      return null;
    } finally {
      setQuoting(false);
    }
  }

  async function review() {
    setFailure(null);
    setStage("review");
    await refreshQuote(choices);
  }

  async function applyCode(event: React.FormEvent) {
    event.preventDefault();
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setFailure(null);
    await refreshQuote({ ...choices, couponCode: code });
  }

  async function removeCode() {
    setCodeInput("");
    setCodeMessage(null);
    await refreshQuote({ ...choices, couponCode: null });
  }

  async function pay() {
    if (!quote?.selectedMethodId) return;
    setPending(true);
    setFailure(null);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkoutKey: checkoutKey(), ...delivery,
          lines: lines.map(line => ({ variantId: line.variantId, quantity: line.quantity })),
          shippingMethodId: quote.selectedMethodId, couponCode: choices.couponCode, expectedTotalCents: quote.totalCents,
        }),
      });
      const body = await response.json().catch(() => ({})) as Partial<CheckoutStartResult> & ErrorBody;
      if (response.ok && body.kind === "redirect" && body.url) {
        window.location.assign(body.url);
        return;
      }
      if (response.ok && body.kind === "paid" && body.number) {
        finishCheckoutSession();
        clearCart();
        onPlaced(body.number);
        return;
      }
      if (body.fieldErrors && !body.code) setStage("details");
      if (body.problems) router.refresh();
      setFailure({ message: body.error ?? "We could not start payment. Nothing was charged.", problems: body.problems, fieldErrors: body.code ? undefined : body.fieldErrors });
      // The code, delivery option or total changed: show the current figures before any retry.
      if (body.code === "coupon") {
        setCodeMessage({ ok: false, text: body.error ?? "This code can't be used." });
        await refreshQuote({ ...choices, couponCode: null });
      } else if (body.code === "shipping" || body.code === "total_changed") {
        await refreshQuote(choices);
      }
    } catch {
      setFailure({ message: "We couldn't reach Cartiva. Check your connection and try again. Nothing was charged." });
    }
    setPending(false);
    focusAlert();
  }

  const fieldError = (name: FieldName) => failure?.fieldErrors?.[name];
  const errorProps = (name: FieldName) => fieldError(name) ? { "aria-invalid": true, "aria-describedby": `checkout-${name}-error` } : {};
  const errorText = (name: FieldName) => fieldError(name) && <span id={`checkout-${name}-error`} className="checkout-field-error">{fieldError(name)}</span>;
  const canPay = Boolean(quote?.selectedMethodId) && !quote?.shippingMessage && !quote?.problems.length && !quoting;
  const selected = quote?.methods.find(method => method.id === quote.selectedMethodId) ?? null;

  const alert = failure && <div className="checkout-alert" role="alert" tabIndex={-1} ref={alertRef}><p>{failure.message}</p>
    {failure.problems && failure.problems.length > 0 && <ul>{failure.problems.map(problem => <li key={problem.variantId}>{problem.name ?? itemName(problem.variantId)}: {problem.reason === "unavailable" ? "no longer available" : problem.available === 0 ? "sold out" : `only ${problem.available} left`}</li>)}</ul>}
    {failure.problems && <Link href="/cart">Review your bag →</Link>}
  </div>;

  return <main id="main" className="page-frame checkout-page"><Link href="/cart" className="back-link">← Back to your bag</Link><div className="page-heading"><h1>Make it yours.</h1><div className="checkout-steps" aria-label="Checkout progress"><span aria-current={stage === "details" ? "step" : undefined}>Delivery details</span><Icon name="chevron" size={12} /><span aria-current={stage === "review" ? "step" : undefined}>Review and pay</span></div></div>
    {canceled && <div className="checkout-notice" role="status">Payment was canceled. Nothing was charged, and your bag is just as you left it.</div>}
    <div className="demo-banner">Sandbox store · Payments run in Stripe test mode, so no real money moves.{publicDemo && " This is a public demo: please use a made-up name and address."}</div>
    <div className="cart-layout"><div>
      {stage === "details" ? <form className="checkout-form" method="post" onSubmit={event => { event.preventDefault(); void review(); }}>
        <h2>Where should it go?</h2>{alert}
        {fields.map(field => <label key={field.name}>{field.label}<input type={field.name === "email" ? "email" : "text"} name={field.name} autoComplete={field.autoComplete} required minLength={field.name === "email" ? undefined : field.name === "address" ? 4 : 2} maxLength={field.name === "address" ? 200 : field.name === "email" ? 254 : 100} value={delivery[field.name]} onChange={event => update(field.name, event.target.value)} placeholder={field.placeholder} {...errorProps(field.name)} />{errorText(field.name)}</label>)}
        <div className="form-row"><label>City<input name="city" autoComplete="shipping address-level2" required minLength={2} maxLength={100} value={delivery.city} onChange={event => update("city", event.target.value)} placeholder="New York" {...errorProps("city")} />{errorText("city")}</label><label>State<select required name="state" autoComplete="shipping address-level1" value={delivery.state} onChange={event => update("state", event.target.value)} {...errorProps("state")}><option value="">Select state</option>{usStates.map(state => <option key={state}>{state}</option>)}</select>{errorText("state")}</label><label>ZIP code<input name="zip" inputMode="numeric" autoComplete="shipping postal-code" required pattern="[0-9]{5}(-[0-9]{4})?" title="Enter a 5-digit US ZIP code or ZIP+4" value={delivery.zip} onChange={event => update("zip", event.target.value)} placeholder="10001" {...errorProps("zip")} />{errorText("zip")}</label></div>
        <label>Country<input readOnly value="United States" /></label><button type="submit" className="button primary" disabled={!hydrated}>Review your order <Icon name="arrow" /></button>
      </form> : <div className="checkout-review">{alert}<div className="section-heading"><h2>Delivery details</h2><button className="text-button" onClick={() => { setFailure(null); setStage("details"); }}>Edit</button></div><address>{delivery.name}<br />{delivery.address}<br />{delivery.city}, {delivery.state} {delivery.zip}<br />United States</address><p>{delivery.email}</p>

        <fieldset className="checkout-methods" aria-busy={quoting}><legend>How would you like it?</legend>
          {!quote && quoting && <p className="muted" role="status">Finding delivery options for {delivery.state}…</p>}
          {quote?.shippingMessage && <p className="checkout-alert" role="alert">{quote.shippingMessage}</p>}
          {quote?.methods.map(method => {
            const eta = deliveryWindow(method);
            return <label className="checkout-method" key={method.id}>
              <input type="radio" name="shipping-method" value={method.id} checked={quote.selectedMethodId === method.id} disabled={quoting} onChange={() => { void refreshQuote({ ...choices, shippingMethodId: method.id }); }} />
              <span><strong>{method.name}</strong><small>{method.kind === "pickup" ? method.address : eta ? `Arrives in ${eta}` : "Delivery"}</small>{method.kind === "pickup" && method.instructions && <small>{method.instructions}</small>}</span>
              <b>{method.priceCents === 0 ? "Free" : money(method.priceCents)}{method.basePriceCents > method.priceCents && <s>{money(method.basePriceCents)}</s>}</b>
            </label>;
          })}
        </fieldset>

        <form className="checkout-code" onSubmit={applyCode} noValidate>
          <label htmlFor="checkout-code">Discount code</label>
          <div><input id="checkout-code" value={codeInput} maxLength={32} autoCapitalize="characters" autoComplete="off" onChange={event => setCodeInput(event.target.value)} aria-invalid={codeMessage && !codeMessage.ok ? true : undefined} aria-describedby={codeMessage ? "checkout-code-message" : undefined} />
            {choices.couponCode ? <button type="button" className="button" onClick={() => { void removeCode(); }} disabled={quoting}>Remove</button> : <button type="submit" className="button" disabled={quoting || !codeInput.trim()}>Apply</button>}</div>
          {codeMessage && <p id="checkout-code-message" className={codeMessage.ok ? "checkout-code-ok" : "checkout-field-error"} role="status">{codeMessage.text}</p>}
        </form>

        <h2>Payment</h2><p>You&apos;ll pay on Stripe&apos;s secure page. Your card details go to Stripe, never to Cartiva.</p>
        <div className="checkout-sandbox"><strong>Test card</strong><span>4242 4242 4242 4242 · any future date · any CVC</span></div>
        <button type="button" className="button primary" onClick={() => { void pay(); }} disabled={pending || !hydrated || !canPay}>{pending ? "Opening secure payment…" : <>Pay {quote ? money(quote.totalCents) : ""} <Icon name="arrow" /></>}</button>
        <p className="small-note">We hold these pieces for {RESERVATION_MINUTES} minutes while you pay. Your order is placed only after Stripe confirms the payment.</p></div>}
    </div><div><div className="checkout-products">{lines.map(line => {
      const product = products.find(item => item.id === line.productId)!;
      const variant = getVariant(product, line.variantId)!;
      const photo = getVariantMedia(product, variant)[0];
      return <div className="checkout-product" key={`${line.productId}-${line.variantId}`}><div className="checkout-thumbnail">{photo ? <Image src={photo.src} alt={photo.alt} fill sizes="64px" /> : <span className="purchase-missing-image">Image unavailable</span>}</div><div className="purchase-item-copy"><Link href={`/products/${product.slug}?variant=${encodeURIComponent(variant.id)}`}>{product.name}</Link><p>{getVariantLabel(variant)} · Qty {line.quantity}</p><p className="purchase-sku">SKU: {variant.sku}</p></div><span>{money(variant.price * line.quantity)}</span></div>;
    })}</div>
      <aside className="order-summary" aria-live="polite"><h2>Your summary</h2>{stage === "review" && quote ? <dl>
        <div><dt>Subtotal</dt><dd>{money(quote.subtotalCents)}</dd></div>
        {quote.discountCents > 0 && <div className="summary-discount"><dt>Discount{choices.couponCode ? ` (${choices.couponCode})` : ""}</dt><dd>−{money(quote.discountCents)}</dd></div>}
        <div><dt>{selected?.name ?? "Delivery"}</dt><dd>{selected ? (quote.shippingCents === 0 ? "Free" : money(quote.shippingCents)) : "—"}</dd></div>
        <div><dt>Sales tax</dt><dd>Not collected</dd></div>
        <div className="summary-total"><dt>Total</dt><dd>{money(quote.totalCents)}</dd></div>
      </dl> : <dl>
        <div><dt>Subtotal</dt><dd>{money(subtotal(lines, products))}</dd></div>
        <div><dt>Delivery</dt><dd>Next step</dd></div>
        <div><dt>Sales tax</dt><dd>Not collected</dd></div>
      </dl>}{quoting && quote && <p className="summary-note" role="status">Updating your totals…</p>}<p className="summary-note">USD · Totals come from Cartiva&apos;s server and are checked again when you pay.</p></aside>
    </div></div></main>;
}
