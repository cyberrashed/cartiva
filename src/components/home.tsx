"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { money } from "@/lib/cart";
import { Icon } from "./icon";
import { ProductCard } from "./product-card";
import { useCatalog } from "./store-provider";

const contexts = [
  { title: "At home", category: "Home & living", description: "Objects that make a room feel like yours." },
  { title: "At work", category: "Tech", description: "A little focus. A better everyday setup." },
  { title: "On the move", category: "Everyday carry", description: "Useful companions for wherever the day goes." },
];

export function Home() {
  const [selection, setSelection] = useState(0);
  const section = useRef<HTMLDivElement>(null);
  const products = useCatalog();
  const context = contexts[selection];
  const featured = products.find(p => p.category === context.category) ?? products[0];
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); }
    }, { threshold: 0.1 });
    section.current?.querySelectorAll(".reveal").forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  return <main id="main" ref={section}>
    <section className="home-stage" aria-label="The Cartiva collection">
      <div className="stage-copy">
        <div className="hero-intro">
          <h1 className="reveal">Good things.<br />Every day.</h1>
          <p className="hero-description reveal">Considered finds for your home, your desk, and everywhere in between.</p>
          <Link className="button primary reveal" href="/products">Explore the collection <Icon name="arrow" /></Link>
        </div>
        <div className="context-picker">
          <h2 className="reveal">Find your everyday.</h2>
          <div className="context-options reveal" role="group" aria-label="Choose a shopping context">
            {contexts.map((item, index) => <button key={item.title} aria-pressed={selection === index} onClick={() => setSelection(index)}>{item.title}<span>{selection === index ? "Selected" : "Explore"}</span></button>)}
          </div>
          <div className="context-description" aria-live="polite"><p>{context.description}</p>{featured && <Link href={`/products/${featured.slug}`}>{featured.name} <span>{money(featured.price)}</span><Icon name="arrow" size={18} /></Link>}</div>
        </div>
      </div>
      <div className="stage-photo">
        <div className="stage-media">
          {contexts.map((item, index) => {
            const product = products.find(p => p.category === item.category) ?? products[0];
            const src = index === 0 || !product ? "/images/editorial-room.jpg" : product.image;
            const alt = index === 0 || !product ? "Soft daylight, natural materials, and a quiet place to slow down" : product.imageAlt;
            return <Image key={item.title} src={src} alt={index === selection ? alt : ""} fill sizes="(max-width: 700px) 100vw, 50vw" preload={index === 0} className={selection === index ? "active" : ""} />;
          })}
        </div>
        <div className="stage-caption"><span>{context.title}, with Cartiva.</span><span>Explore a little.</span></div>
      </div>
    </section>
    <section className="collection-section" aria-labelledby="collection-title">
      <div className="section-heading reveal"><h2 id="collection-title">The everyday edit</h2><Link href="/products" className="text-link">View the collection <Icon name="arrow" /></Link></div>
      <p className="section-description reveal">A few good finds. Plenty of ways to make them yours.</p>
      {!products.length && <p className="section-description">New finds are on the way. Check back soon.</p>}
      <div className="product-grid home-grid">{products.slice(0, 8).map((product, index) => <div className="reveal" key={product.id} style={{ animationDelay: `${index % 4 * 70}ms` }}><ProductCard product={product} /></div>)}</div>
    </section>
  </main>;
}
