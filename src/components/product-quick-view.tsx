"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { getVariantMedia, type Product } from "@/lib/catalog";
import { money } from "@/lib/cart";
import { Icon } from "./icon";
import { ProductOptions, useProductSelection } from "./product-options";
import "@/app/product-interactions.css";

export function ProductQuickView({ product }: { product: Product }) {
  const [open, setOpen] = useState(false);
  const { options, variant, remaining, amount, message, stockMessage, setAmount, changeOption, reset, add } = useProductSelection(product);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const photo = variant ? getVariantMedia(product, variant)[0] : undefined;

  useEffect(() => {
    const current = dialog.current;
    if (open && current && !current.open) current.showModal();
    return () => { if (current?.open) current.close(); };
  }, [open]);

  return <>
    <button type="button" ref={trigger} className="quick-view-trigger" aria-label={`Quick view: ${product.name}`} aria-haspopup="dialog" onClick={() => { reset(); setOpen(true); }}>Quick view</button>
    {open && <dialog ref={dialog} className="shopping-dialog quick-view-dialog" aria-labelledby={titleId} onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}>
      <header className="shopping-dialog-header"><span>Quick view</span><button type="button" className="icon-button" aria-label="Close quick view" onClick={() => dialog.current?.close()}><Icon name="close" /></button></header>
      <div className="quick-view-content">
        <div className="quick-view-image">{photo ? <Image src={photo.src} alt={photo.alt} fill sizes="(max-width: 600px) 90vw, 360px" /> : <p className="variant-photo-unavailable">Choose an available option to view its photo.</p>}</div>
        <div className="quick-view-details">
          <p className="quick-view-seller">From {product.vendor}</p><h2 id={titleId}>{product.name}</h2>
          <p className="quick-view-price" aria-live="polite">{variant ? <>{money(variant.price)}{variant.compareAtPrice && <del>{money(variant.compareAtPrice)}</del>}</> : <span className="variant-price-unavailable">Choose available options to see the price</span>}</p>
          <ProductOptions product={product} options={options} onChange={changeOption} />
          {variant?.options.Set === "Pair" && <p className="variant-set-note">One pair includes two mugs. The price is for the pair.</p>}
          {variant && <p className="variant-sku">SKU: {variant.sku}</p>}
          <p className="quick-view-stock" role="status">{stockMessage}</p>
          <div className="quick-view-purchase"><div className="quantity-control"><button type="button" aria-label="Decrease quantity" disabled={amount <= 1} onClick={() => setAmount(Math.max(1, amount - 1))}><Icon name="minus" size={16} /></button><output aria-label="Quantity">{amount}</output><button type="button" aria-label="Increase quantity" disabled={amount >= remaining} onClick={() => setAmount(amount + 1)}><Icon name="plus" size={16} /></button></div><button type="button" className="button primary" disabled={remaining < 1} onClick={add}>Add to bag <Icon name="bag" size={18} /></button></div>
          <div className="cart-feedback" role="status">{message && <>{message} <Link href="/cart" onClick={() => dialog.current?.close()}>View bag</Link></>}</div>
          <Link className="quick-view-full" href={`/products/${product.slug}${variant ? `?variant=${encodeURIComponent(variant.id)}` : ""}`} onClick={() => dialog.current?.close()}>View full product details <Icon name="arrow" size={17} /></Link>
        </div>
      </div>
    </dialog>}
  </>;
}
