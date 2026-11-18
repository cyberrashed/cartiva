import { fulfillmentStatusLabels, orderStatusLabels, paymentStatusLabels, type OrderDTO } from "@/lib/checkout";

const orderDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export function formatOrderDate(iso: string) {
  return orderDate.format(new Date(iso));
}

/** Order, payment and fulfillment are separate states, so each gets its own badge. */
export function OrderBadges({ order, showOrder = false }: { order: Pick<OrderDTO, "status" | "paymentStatus" | "fulfillmentStatus">; showOrder?: boolean }) {
  const paymentTone = order.paymentStatus === "paid" ? "is-good" : order.paymentStatus === "awaiting" ? "is-waiting" : "is-ended";
  return <span className="order-badges">
    {showOrder && <span className={`order-badge ${order.status === "placed" ? "is-good" : order.status === "canceled" ? "is-ended" : "is-waiting"}`}>{orderStatusLabels[order.status]}</span>}
    <span className={`order-badge ${paymentTone}`}>{paymentStatusLabels[order.paymentStatus]}</span>
    {order.status === "placed" && <span className="order-badge">{fulfillmentStatusLabels[order.fulfillmentStatus]}</span>}
  </span>;
}
