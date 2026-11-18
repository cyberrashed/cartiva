import Link from "next/link";
import { Header, Footer } from "@/components/store-shell";
import { StoreProvider } from "@/components/store-provider";
import { getStorefrontCatalog } from "@/server/catalog-cache";
import { getFreeDeliveryHint } from "@/server/checkout-settings-cache";
import { demoMode } from "@/server/demo";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const [catalog, freeDelivery] = await Promise.all([getStorefrontCatalog(), getFreeDeliveryHint()]);
  return <StoreProvider catalog={catalog} freeDelivery={freeDelivery}>
    {demoMode() && <div className="demo-strip"><span>Portfolio demo · Stripe sandbox, no real charges</span><Link href="/demo">Explore as a shopper or the store admin →</Link></div>}
    <Header />{children}<Footer />
  </StoreProvider>;
}
