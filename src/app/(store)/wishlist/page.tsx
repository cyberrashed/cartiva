import { Suspense } from "react";
import { CatalogView } from "@/components/catalog-view";
export const metadata = { title: "Your saved finds" };
export default function WishlistPage() { return <Suspense fallback={<main id="main" className="page-frame loading-state">Opening your saved finds…</main>}><CatalogView savedOnly /></Suspense>; }
