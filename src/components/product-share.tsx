"use client";

import { useState } from "react";
import type { Product } from "@/lib/catalog";
import "@/app/product-interactions.css";

export function ProductShare({ product, variantId }: { product: Product; variantId?: string }) {
  const [message, setMessage] = useState("");
  const [manualLink, setManualLink] = useState("");
  const [pending, setPending] = useState(false);

  const productUrl = () => {
    const url = new URL(`/products/${product.slug}`, window.location.origin);
    if (variantId) url.searchParams.set("variant", variantId);
    return url.href;
  };

  async function copyLink() {
    setPending(true);
    setManualLink("");
    try {
      await navigator.clipboard.writeText(productUrl());
      setMessage("Product link copied.");
    } catch {
      setManualLink(productUrl());
      setMessage("Copying is unavailable here. Select and copy the link below.");
    } finally { setPending(false); }
  }

  async function share() {
    if (!navigator.share) { await copyLink(); return; }
    setPending(true);
    setManualLink("");
    setMessage("");
    try {
      await navigator.share({ title: `${product.name} | Cartiva`, url: productUrl() });
      setMessage("Share sheet completed.");
    } catch (error) {
      setMessage(error instanceof DOMException && error.name === "AbortError" ? "Sharing cancelled." : "Sharing is unavailable here. Use Copy link instead.");
    } finally { setPending(false); }
  }

  return <div className="product-sharing"><div className="product-sharing-actions"><button type="button" className="text-button" disabled={pending} onClick={share}>Share product</button><button type="button" className="text-button" disabled={pending} onClick={copyLink}>Copy link</button></div><p className="product-share-status" role="status">{message}</p>{manualLink && <label className="product-share-link">Product link<input readOnly value={manualLink} onFocus={event => event.currentTarget.select()} /></label>}</div>;
}
