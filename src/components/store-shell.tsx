"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { useStore } from "./store-provider";

export function Header() {
  const [open, setOpen] = useState(false);
  const { lines, saved } = useStore();
  const pathname = usePathname();
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="store-header">
      <Link href="/" className="wordmark" aria-label="Cartiva home">cartiva</Link>
      <nav className="desktop-nav" aria-label="Main navigation">
        <Link href="/products" aria-current={pathname === "/products" ? "page" : undefined}>Collection</Link>
        <Link href="/products?category=Home+%26+living">Home & living</Link>
        <Link href="/products?category=Tech">Tech</Link>
        <Link href="/products?category=Everyday+carry">Everyday carry</Link>
        <Link href="/become-vendor" aria-current={pathname.startsWith("/become-vendor") ? "page" : undefined}>Become a seller</Link>
      </nav>
      <div className="header-actions">
        <Link className="icon-button" href="/products?search=1" aria-label="Search products"><Icon name="search" /></Link>
        <Link className="icon-button saved-link" href="/wishlist" aria-label={`Saved items, ${saved.length}`}><Icon name="heart" />{saved.length > 0 && <span className="count">{saved.length}</span>}</Link>
        <Link className="icon-button account-link" href="/account" aria-label="Your account" aria-current={pathname.startsWith("/account") ? "page" : undefined}><Icon name="user" /></Link>
        <Link className="bag-link" href="/cart" aria-label={`Shopping bag, ${count} items`}><Icon name="bag" /><span>Bag ({count})</span></Link>
        <button className="icon-button menu-toggle" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)}><Icon name={open ? "close" : "menu"} /></button>
      </div>
    </header>
    {open && <nav id="mobile-navigation" className="mobile-navigation" aria-label="Mobile navigation" onClick={() => setOpen(false)}>
      <Link href="/products">The collection</Link><Link href="/products?category=Home+%26+living">Home & living</Link><Link href="/products?category=Tech">Tech</Link><Link href="/products?category=Everyday+carry">Everyday carry</Link><Link href="/wishlist">Saved items</Link><Link href="/account">Your account & orders</Link><Link href="/become-vendor">Become a seller</Link><Link href="/help">Help</Link>
    </nav>}
  </>;
}

export function Footer() {
  return <footer className="store-footer">
    <div className="footer-picture"><Image src="/images/editorial-room.jpg" alt="A quiet, sunlit contemporary living room" fill sizes="(max-width: 700px) 100vw, 50vw" /><span className="image-caption">Room for the everyday.</span></div>
    <div className="footer-content">
      <Link href="/" className="wordmark">cartiva</Link>
      <h2>A place for<br />good things.</h2>
      <nav aria-label="Footer navigation"><Link href="/products">Shop the collection</Link><Link href="/wishlist">Your saved finds</Link><Link href="/account">Your account & orders</Link><Link href="/track-order">Find an order</Link><Link href="/become-vendor">Become a seller</Link><Link href="/help">Shopping help</Link><Link href="/admin">Explore the workspace</Link></nav>
      <div className="footer-meta"><span>United States · USD</span><Link href="/credits">Photography credits</Link></div>
      <p className="preview-note">Cartiva portfolio store. Products and sellers are sample data. Checkout runs in Stripe&apos;s sandbox, so no real money moves.</p>
    </div>
  </footer>;
}
