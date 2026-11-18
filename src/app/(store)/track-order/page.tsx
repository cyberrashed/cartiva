import { OrderLookup } from "@/components/order-lookup";

export const metadata = { title: "Find your order", robots: { index: false, follow: false } };

export default function TrackOrderPage() {
  return <OrderLookup />;
}
