"use client";

import Image from "next/image";
import Link from "next/link";
import { getDefaultVariant, getVariantLabel, getVariantMedia, type Product } from "@/lib/catalog";
import { money } from "@/lib/cart";
import { Icon } from "./icon";
import { useStore } from "./store-provider";
import { ProductQuickView } from "./product-quick-view";

export function ProductCard({ product }: { product: Product }) {
  const { saved, toggleSaved } = useStore();
  const selected = saved.includes(product.id);
  const variant = getDefaultVariant(product);
  const photo = getVariantMedia(product, variant)[0];
  return <article className="product-card">
    <div className="product-image">
      <Link href={`/products/${product.slug}`} tabIndex={-1} aria-hidden="true"><Image src={photo.src} alt={photo.alt} fill sizes="(max-width: 600px) 50vw, (max-width: 1000px) 33vw, 25vw" /></Link>
      <button className={`save-button${selected ? " is-saved" : ""}`} aria-label={`${selected ? "Unsave" : "Save"} ${product.name}`} aria-pressed={selected} onClick={() => toggleSaved(product.id)}><Icon name="heart" /></button>
      <ProductQuickView product={product} />
    </div>
    <div className="product-meta"><span>{product.vendor}</span><span>{product.category}</span></div>
    <div className="product-title"><h3><Link href={`/products/${product.slug}`}>{product.name}</Link></h3><span>{money(variant.price)}</span></div>
    <p className="product-color">{getVariantLabel(variant)}</p>
  </article>;
}
