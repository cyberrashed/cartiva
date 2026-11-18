export const sampleToday = "2026-11-08";
export const sampleCustomer = {
  name: "Alex Morgan",
  email: "alex@example.com",
  address: ["123 Sample Street", "New York, NY 10001", "United States"],
};

export type CustomerOrderLine = {
  id: string;
  productId: string;
  name: string;
  color: string;
  quantity: number;
  unitPrice: number;
};

export type Parcel = {
  id: string;
  seller: string;
  items: { lineId: string; quantity: number }[];
  shippedOn?: string;
  deliveredOn?: string;
  estimatedDelivery?: string;
};

export type CustomerOrder = {
  id: string;
  placedOn: string;
  delivery: number;
  lines: CustomerOrderLine[];
  parcels: Parcel[];
};

// Fixed November 2026 scenarios. Prices are order snapshots in USD cents,
// independent of later catalog edits; none of these orders came from checkout.
export const customerOrders: CustomerOrder[] = [
  {
    id: "DEMO-1107",
    placedOn: "2026-11-07",
    delivery: 900,
    lines: [{ id: "headphones", productId: "studio-headphones", name: "Studio headphones", color: "Ivory", quantity: 1, unitPrice: 14800 }],
    parcels: [{ id: "parcel-1", seller: "Signal Studio", items: [{ lineId: "headphones", quantity: 1 }] }],
  },
  {
    id: "DEMO-1104",
    placedOn: "2026-11-04",
    delivery: 900,
    lines: [
      { id: "mugs", productId: "ritual-ceramic-mug", name: "Ritual ceramic mug", color: "Sage", quantity: 2, unitPrice: 2800 },
      { id: "bag", productId: "field-commuter-bag", name: "Field commuter bag", color: "Sandstone", quantity: 1, unitPrice: 8900 },
    ],
    parcels: [
      { id: "parcel-1", seller: "Form & Field", items: [{ lineId: "mugs", quantity: 2 }], shippedOn: "2026-11-05", deliveredOn: "2026-11-06" },
      { id: "parcel-2", seller: "Wayfare Goods", items: [{ lineId: "bag", quantity: 1 }], shippedOn: "2026-11-06", estimatedDelivery: "2026-11-10" },
    ],
  },
  {
    id: "DEMO-1101",
    placedOn: "2026-11-01",
    delivery: 0,
    lines: [
      { id: "light", productId: "halo-table-light", name: "Halo table light", color: "Opal & chrome", quantity: 1, unitPrice: 9600 },
      { id: "watch", productId: "line-mesh-watch", name: "Line mesh watch", color: "Brushed silver", quantity: 1, unitPrice: 11200 },
    ],
    parcels: [
      { id: "parcel-1", seller: "Form & Field", items: [{ lineId: "light", quantity: 1 }], shippedOn: "2026-11-02", deliveredOn: "2026-11-04" },
      { id: "parcel-2", seller: "Wayfare Goods", items: [{ lineId: "watch", quantity: 1 }], shippedOn: "2026-11-02", deliveredOn: "2026-11-05" },
    ],
  },
];

export const returnReasons = ["Arrived damaged", "Not as expected", "Wrong item", "Changed my mind"] as const;
export type ReturnDraft = { lineId: string; quantity: number; reason: string };
export type ReturnRequest = ReturnDraft & {
  id: string;
  orderId: string;
  status: "Awaiting review" | "Cancelled";
};

export function orderTotals(order: CustomerOrder) {
  const merchandise = order.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  return { merchandise, delivery: order.delivery, totalBeforeTax: merchandise + order.delivery };
}

export function parcelStatus(parcel: Parcel) {
  return parcel.deliveredOn ? "Delivered" : parcel.shippedOn ? "In transit" : "Preparing";
}

export function orderStatus(order: CustomerOrder) {
  if (order.parcels.every(parcel => parcel.deliveredOn)) return "Delivered";
  if (order.parcels.some(parcel => parcel.deliveredOn)) return "Partially delivered";
  return order.parcels.some(parcel => parcel.shippedOn) ? "In transit" : "Preparing";
}

export function returnWindowEnd(deliveredOn: string) {
  const date = new Date(`${deliveredOn}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 14);
  return date.toISOString().slice(0, 10);
}

export function returnableQuantity(
  order: CustomerOrder,
  lineId: string,
  requests: readonly ReturnRequest[],
  asOf = sampleToday,
) {
  const line = order.lines.find(item => item.id === lineId);
  if (!line) return 0;
  const delivered = order.parcels
    .filter(parcel => parcel.deliveredOn && parcel.deliveredOn <= asOf && returnWindowEnd(parcel.deliveredOn) >= asOf)
    .flatMap(parcel => parcel.items)
    .filter(item => item.lineId === lineId)
    .reduce((sum, item) => sum + item.quantity, 0);
  const requested = requests
    .filter(request => request.orderId === order.id && request.lineId === lineId && request.status !== "Cancelled")
    .reduce((sum, request) => sum + request.quantity, 0);
  return Math.max(0, Math.min(line.quantity, delivered) - requested);
}

export function validateReturn(
  order: CustomerOrder,
  requests: readonly ReturnRequest[],
  draft: ReturnDraft,
) {
  const errors: { lineId?: string; quantity?: string; reason?: string } = {};
  const available = returnableQuantity(order, draft.lineId, requests);
  if (!available) errors.lineId = "Choose an item with delivered units available to return.";
  if (!Number.isInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > available) {
    errors.quantity = available ? `Choose a whole quantity from 1 to ${available}.` : "No units are available for this request.";
  }
  if (!returnReasons.some(reason => reason === draft.reason)) errors.reason = "Choose a return reason.";
  return errors;
}

export function orderDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));
}
