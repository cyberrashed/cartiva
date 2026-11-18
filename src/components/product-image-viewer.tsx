"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { getVariantMedia, type Product, type ProductMedia, type ProductVariant } from "@/lib/catalog";
import { Icon } from "./icon";
import "@/app/product-interactions.css";

function GalleryImage({ media, sizes, preload = false }: { media: ProductMedia; sizes: string; preload?: boolean }) {
  const [failed, setFailed] = useState(false);
  return failed ? <div className="gallery-image-fallback">Image unavailable: {media.label}</div> : <Image src={media.src} alt={media.alt} fill sizes={sizes} preload={preload} onError={() => setFailed(true)} />;
}

export function ProductImageViewer({ product, variant }: { product: Product; variant?: ProductVariant }) {
  const images = variant ? getVariantMedia(product, variant) : [];
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const titleId = useId();
  const media = images[index] ?? images[0];

  function select(next: number) {
    setIndex((next + images.length) % images.length);
    setEnlarged(false);
    stage.current?.scrollTo({ top: 0, left: 0 });
  }

  useEffect(() => {
    const current = dialog.current;
    if (open && current && !current.open) current.showModal();
    return () => { if (current?.open) current.close(); };
  }, [open]);

  if (!media) return <div className="detail-image gallery-image-fallback">Choose an available combination to view its image.</div>;

  const controls = images.length > 1 && <div className="gallery-navigation"><button type="button" className="icon-button" aria-label="Previous product image" onClick={() => select(index - 1)}>←</button><p role="status">{index + 1} of {images.length} · {media.label}</p><button type="button" className="icon-button" aria-label="Next product image" onClick={() => select(index + 1)}>→</button></div>;

  return <section className="product-gallery" aria-label={`${product.name} photos`} onKeyDown={event => {
    if (images.length < 2 || (open && enlarged) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      select(index + (event.key === "ArrowRight" ? 1 : -1));
    }
  }}>
    <button type="button" ref={trigger} className="detail-image product-image-open" aria-label={`Enlarge image of ${product.name}`} aria-haspopup="dialog" onTouchStart={event => {
      swiped.current = false;
      touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }} onTouchEnd={event => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start || images.length < 2) return;
      const dx = event.changedTouches[0].clientX - start.x;
      const dy = event.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { swiped.current = true; select(index + (dx < 0 ? 1 : -1)); }
    }} onClick={event => {
      if (swiped.current && event.detail !== 0) { swiped.current = false; return; }
      setEnlarged(false); setOpen(true);
    }}><GalleryImage key={media.id} media={media} sizes="(max-width: 700px) 100vw, 55vw" preload /><span>Enlarge image <Icon name="plus" size={16} /></span></button>
    {controls}
    {images.length > 1 && <div className="gallery-thumbnails" aria-label="Choose a product image">{images.map((item, position) => <button type="button" key={item.id} aria-label={`View image ${position + 1}: ${item.label}`} aria-current={position === index ? "true" : undefined} onClick={() => select(position)}><Image src={item.src} alt="" fill sizes="80px" /></button>)}</div>}
    {product.id === "ritual-ceramic-mug" && <p className="gallery-note">Illustrative sample images. Pair includes two mugs in the selected color. <a href="/credits">Image credits</a></p>}
    {open && <dialog ref={dialog} className="shopping-dialog product-viewer-dialog" aria-labelledby={titleId} onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}>
      <header className="shopping-dialog-header"><h2 id={titleId}>{product.name}</h2><div><button type="button" className="viewer-size-toggle" aria-pressed={enlarged} onClick={() => { setEnlarged(value => !value); stage.current?.scrollTo({ top: 0, left: 0 }); }}>{enlarged ? "Fit image" : "Enlarge 2×"}</button><button type="button" className="icon-button" aria-label="Close image viewer" onClick={() => dialog.current?.close()}><Icon name="close" /></button></div></header>
      <div ref={stage} className="product-viewer-stage" tabIndex={0} role="region" aria-label={enlarged ? "Enlarged product image. Scroll to explore." : "Full product image"}><div className={`product-viewer-canvas${enlarged ? " is-enlarged" : ""}`}><GalleryImage key={media.id} media={media} sizes="(max-width: 700px) 180vw, 2000px" /></div></div>
      {controls}
      <p className="product-viewer-caption">{enlarged ? "Scroll to explore. Choose Fit image to see the whole photo." : "Full product photo. Choose Enlarge 2× for a closer look."}</p>
    </dialog>}
  </section>;
}
