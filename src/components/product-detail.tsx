"use client";

import Link from "next/link";
import { type Product } from "@/lib/catalog";
import { money } from "@/lib/cart";
import { useStore } from "./store-provider";
import { Icon } from "./icon";
import { ProductCard } from "./product-card";
import { ProductImageViewer } from "./product-image-viewer";
import { ProductShare } from "./product-share";
import { ProductOptions, useProductSelection } from "./product-options";

export function ProductDetail({ product, related, initialVariantId }: { product: Product; related: Product[]; initialVariantId?: string }) {
  const { saved, toggleSaved, freeDelivery } = useStore();
  const { options, variant, remaining, amount, message, stockMessage, setAmount, changeOption, add } = useProductSelection(product, initialVariantId);
  const selectedSaved = saved.includes(product.id);
  return <main id="main" className="product-page page-frame">
    <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/products">Collection</Link><Icon name="chevron" size={12} /><Link href={`/products?category=${encodeURIComponent(product.category)}`}>{product.category}</Link><Icon name="chevron" size={12} /><span>{product.name}</span></nav>
    <div className="detail-grid">
      <ProductImageViewer key={variant?.id ?? "unavailable"} product={product} variant={variant} />
      <div className="detail-copy"><p className="seller-line">From {product.vendor}</p><h1>{product.name}</h1><p className="detail-price" aria-live="polite">{variant ? <>{money(variant.price)}{variant.compareAtPrice && <del>{money(variant.compareAtPrice)}</del>}</> : <span className="variant-price-unavailable">Choose available options to see the price</span>}</p><p className="detail-description">{product.description}</p>
        <ProductOptions product={product} options={options} onChange={changeOption} />
        {variant?.options.Set === "Pair" && <p className="variant-set-note">One pair includes two mugs. The price is for the pair.</p>}
        {variant && <p className="variant-sku">SKU: {variant.sku}</p>}
        <p className="stock-label" role="status">{stockMessage}</p>
        <div className="purchase-controls"><div className="quantity-control"><button aria-label="Decrease quantity" disabled={amount <= 1} onClick={() => setAmount(Math.max(1, amount - 1))}><Icon name="minus" size={16} /></button><output aria-label="Quantity">{amount}</output><button aria-label="Increase quantity" disabled={amount >= remaining} onClick={() => setAmount(amount + 1)}><Icon name="plus" size={16} /></button></div><button className="button primary add-to-bag" disabled={remaining <= 0} onClick={add}>Add to bag <Icon name="bag" /></button><button className="icon-button detail-save" aria-label={selectedSaved ? "Remove from saved items" : "Save this product"} aria-pressed={selectedSaved} onClick={() => toggleSaved(product.id)}><Icon name="heart" /></button></div>
        <div className="cart-feedback" role="status">{message && <><Icon name="check" size={16} />{message} <Link href="/cart">View bag</Link></>}</div>
        <ProductShare key={variant?.id ?? "unavailable"} product={product} variantId={variant?.id} />
        <details open><summary>The details</summary><ul>{product.details.map(detail => <li key={detail}>{detail}</li>)}</ul></details>
        <details><summary>Delivery & returns</summary><p>Delivery options and prices for your state appear at checkout{freeDelivery ? `; standard delivery is free on bags of ${money(freeDelivery.thresholdCents)} or more in the ${freeDelivery.zoneName}` : ""}. Sales tax is not collected in this sandbox store. Shipping dates and the returns policy arrive with fulfillment.</p></details>
        <details><summary>About the seller</summary><p>{product.vendor} is a sample seller in the Cartiva collection. This preview shows how independent sellers will share one shopping experience.</p></details>
      </div>
    </div>
    <section className="related-section"><div className="section-heading"><h2>Good company</h2><Link className="text-link" href="/products">Keep exploring <Icon name="arrow" /></Link></div><div className="product-grid">{related.map(item => <ProductCard key={item.id} product={item} />)}</div></section>
  </main>;
}
