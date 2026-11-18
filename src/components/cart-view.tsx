"use client";

import Image from "next/image";
import Link from "next/link";
import { getVariant, getVariantLabel, getVariantMedia } from "@/lib/catalog";
import { money, subtotal, type CartLine } from "@/lib/cart";
import { useStore } from "./store-provider";
import { Icon } from "./icon";
import "@/app/purchase-variants.css";

export function Summary({ lines, children }: { lines: CartLine[]; children?: React.ReactNode }) {
  const { products } = useStore();
  const amount = subtotal(lines, products);
  return <aside className="order-summary"><h2>Your summary</h2><dl><div><dt>Subtotal</dt><dd>{money(amount)}</dd></div><div><dt>Delivery</dt><dd>At checkout</dd></div><div><dt>Sales tax</dt><dd>Not collected</dd></div><div className="summary-total"><dt>Before delivery</dt><dd>{money(amount)}</dd></div></dl>{children}<p className="summary-note">USD · Delivery options for your state and any discount code are added at checkout. Prices and stock are checked again when you pay.</p></aside>;
}

export function CartView() {
  const { lines, setQuantity, products, freeDelivery } = useStore();
  const amount = subtotal(lines, products);
  if (!lines.length) return <main id="main" className="page-frame cart-page"><h1>Your bag</h1><div className="empty-state"><Icon name="bag" size={40} /><h2>A good place to start.</h2><p>Your bag is waiting for something you love.</p><Link href="/products" className="button primary">Explore the collection</Link></div></main>;
  return <main id="main" className="page-frame cart-page">
    <div className="page-heading cart-heading"><h1>Your bag <span>({lines.reduce((sum, line) => sum + line.quantity, 0)})</span></h1><Link href="/products" className="text-link">Continue exploring <Icon name="arrow" /></Link></div>
    <div className="cart-layout"><div>
      {freeDelivery && <div className="delivery-progress"><p>{amount >= freeDelivery.thresholdCents ? `Your bag qualifies for free standard delivery in the ${freeDelivery.zoneName}.` : `You're ${money(freeDelivery.thresholdCents - amount)} away from free standard delivery in the ${freeDelivery.zoneName}.`}</p><progress max={freeDelivery.thresholdCents} value={Math.min(amount, freeDelivery.thresholdCents)} aria-label="Progress toward free delivery" /></div>}
      <ul className="cart-lines">{lines.map(line => {
        const product = products.find(item => item.id === line.productId)!;
        const variant = getVariant(product, line.variantId)!;
        const photo = getVariantMedia(product, variant)[0];
        const label = getVariantLabel(variant);
        const itemName = `${product.name}, ${label}`;
        const href = `/products/${product.slug}?variant=${encodeURIComponent(variant.id)}`;
        return <li className="cart-line" key={`${line.productId}-${line.variantId}`}><Link href={href} className="cart-image">{photo ? <Image src={photo.src} alt={photo.alt} fill sizes="140px" /> : <span className="purchase-missing-image">Image unavailable</span>}</Link><div className="cart-line-description"><p className="seller-line">{product.vendor}</p><h2><Link href={href}>{product.name}</Link></h2><p className="muted">{label}</p><p className="purchase-sku">SKU: {variant.sku}</p><div className="line-actions"><div className="quantity-control"><button aria-label={`Decrease ${itemName} quantity`} disabled={line.quantity <= 1} onClick={() => setQuantity(product, variant.id, line.quantity - 1)}><Icon name="minus" size={16} /></button><output aria-label={`${itemName} quantity`}>{line.quantity}</output><button aria-label={`Increase ${itemName} quantity`} disabled={line.quantity >= variant.stock} onClick={() => setQuantity(product, variant.id, line.quantity + 1)}><Icon name="plus" size={16} /></button></div><button className="text-button" aria-label={`Remove ${itemName} from bag`} onClick={() => setQuantity(product, variant.id, 0)}>Remove</button></div></div><span className="line-total">{money(variant.price * line.quantity)}</span></li>;
      })}</ul>
    </div><Summary lines={lines}><Link href="/checkout" className="button primary full-width">Continue to checkout <Icon name="arrow" /></Link><p className="small-note">Sandbox payments by Stripe · No real charges</p></Summary></div>
  </main>;
}
