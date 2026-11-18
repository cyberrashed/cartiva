"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { categories, type Product } from "@/lib/catalog";
import { ProductCard } from "./product-card";
import { Icon } from "./icon";
import { useStore } from "./store-provider";

function searchable(product: Product) {
  return `${product.name} ${product.vendor} ${product.category} ${product.variants.map(variant => `${variant.sku} ${Object.values(variant.options).join(" ")}`).join(" ")}`.toLowerCase();
}

export function CatalogView({ savedOnly = false }: { savedOnly?: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const { saved, products } = useStore();
  const query = params.get("q") ?? "";
  const category = params.get("category") ?? "All";
  const [sort, setSort] = useState("featured");
  const [price, setPrice] = useState("all");
  function filter(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value && value !== "All") next.set(name, value); else next.delete(name);
    router.replace(`${savedOnly ? "/wishlist" : "/products"}?${next}`, { scroll: false });
  }
  const visible = products.filter(product => (!savedOnly || saved.includes(product.id)) && (category === "All" || product.category === category) && searchable(product).includes(query.trim().toLowerCase()) && (price === "all" || product.price < Number(price))).sort((a, b) => sort === "low" ? a.price - b.price : sort === "high" ? b.price - a.price : sort === "name" ? a.name.localeCompare(b.name) : 0);
  return <main id="main" className="catalog-page page-frame">
    <div className="page-heading"><h1>{savedOnly ? "Your saved finds" : "The collection"}</h1><p>{savedOnly ? "Good things to come back to." : "For the spaces you live in and the days you make your own."}</p></div>
    <div className="catalog-controls">
      <form role="search" className="catalog-search" action={savedOnly ? "/wishlist" : "/products"} onSubmit={event => { event.preventDefault(); filter("q", String(new FormData(event.currentTarget).get("q") ?? "")); }}><Icon name="search" /><input aria-label="Search the collection" name="q" defaultValue={query} key={query} placeholder="Find something good" type="search" />{category !== "All" && <input type="hidden" name="category" value={category} />}<button type="submit">Search</button></form>
      <div className="catalog-selects"><label>Price<select value={price} onChange={e => setPrice(e.target.value)}><option value="all">Any price</option><option value="5000">Under $50</option><option value="10000">Under $100</option><option value="20000">Under $200</option></select></label><label>Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="name">Name</option></select></label></div>
    </div>
    <div className="category-tabs" role="group" aria-label="Filter by category">{["All", ...categories].map(item => <button key={item} className={item === category ? "active" : ""} aria-pressed={item === category} onClick={() => filter("category", item)}>{item === "All" ? "All finds" : item}</button>)}</div>
    <div className="results-count" aria-live="polite">{visible.length} {visible.length === 1 ? "find" : "finds"}{query && <> for “{query}”</>}</div>
    {visible.length ? <div className="product-grid catalog-grid">{visible.map(product => <ProductCard key={product.id} product={product} />)}</div> : <div className="empty-state"><Icon name={savedOnly ? "heart" : "search"} size={36} /><h2>{savedOnly && !saved.length ? "Keep a good thing close." : "Nothing here just yet."}</h2><p>{savedOnly && !saved.length ? "Tap the heart on a product to save it here." : "Try a different search or reset your filters."}</p><button className="button primary" onClick={() => { setPrice("all"); router.push("/products"); }}>Explore all finds</button></div>}
  </main>;
}
