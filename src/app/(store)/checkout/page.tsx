import { Suspense } from "react";
import { CheckoutView } from "@/components/checkout-view";
import { demoMode } from "@/server/demo";

export const metadata = { title: "Checkout" };

export default function CheckoutPage() {
  // The payment-canceled notice reads the query string, which is only known per request.
  return <Suspense fallback={<main id="main" className="page-frame" aria-busy="true" />}><CheckoutView publicDemo={demoMode()} /></Suspense>;
}
