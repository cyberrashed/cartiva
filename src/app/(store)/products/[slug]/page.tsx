import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ProductDetail } from "@/components/product-detail";
import { getStorefrontCatalog } from "@/server/catalog-cache";

export async function generateStaticParams() {
  const catalog = await getStorefrontCatalog();
  // At least one entry keeps the route prerenderable when the catalog is empty.
  return catalog.length ? catalog.map(product => ({ slug: product.slug })) : [{ slug: "unavailable" }];
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const catalog = await getStorefrontCatalog();
  return { title: catalog.find(product => product.slug === slug)?.name ?? "Product not found" };
}
type ProductPageProps = { params: Promise<{ slug: string }>; searchParams: Promise<{ variant?: string | string[] }> };

async function Details({ params, searchParams }: ProductPageProps) {
  const { slug } = await params;
  const catalog = await getStorefrontCatalog();
  const product = catalog.find(item => item.slug === slug);
  if (!product) notFound();
  const query = await searchParams;
  const initialVariantId = Array.isArray(query.variant) ? "" : query.variant;
  const related = [
    ...catalog.filter(item => item.id !== product.id && item.category === product.category),
    ...catalog.filter(item => item.id !== product.id && item.category !== product.category),
  ].slice(0, 4);
  return <ProductDetail key={`${product.id}:${initialVariantId ?? "default"}`} product={product} initialVariantId={initialVariantId} related={related} />;
}
export default function ProductPage(props: ProductPageProps) {
  return <Suspense fallback={<main id="main" className="page-frame loading-state">Opening this find…</main>}><Details {...props} /></Suspense>;
}
