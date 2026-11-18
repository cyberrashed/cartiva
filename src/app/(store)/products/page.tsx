import { Suspense } from "react";
import { CatalogView } from "@/components/catalog-view";
export const metadata = { title: "The collection" };
export default function ProductsPage() { return <Suspense fallback={<main id="main" className="page-frame loading-state">Opening the collection…</main>}><CatalogView /></Suspense>; }
