import { Suspense } from "react";
import { CheckoutComplete } from "@/components/checkout-complete";

export const metadata = { title: "Order confirmation", robots: { index: false, follow: false } };

export default function CheckoutCompletePage() {
  return <Suspense fallback={<main id="main" className="page-frame confirmation-page" aria-busy="true" />}><CheckoutComplete /></Suspense>;
}
