"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { sampleProducts as products } from "@/lib/sample-catalog";
import { money } from "@/lib/cart";
import { customerOrders, sampleCustomer, sampleToday, orderTotals, orderStatus, parcelStatus, orderDate, returnReasons, returnableQuantity, returnWindowEnd, validateReturn, type CustomerOrder, type ReturnRequest } from "@/lib/customer-orders";

function ProductPhoto({ productId }: { productId: string }) {
  const product = products.find(item => item.id === productId);
  return product ? <Image src={product.image} alt={product.imageAlt} width={64} height={76} /> : null;
}

function ReturnForm({ order, requests, onRequest }: { order: CustomerOrder; requests: ReturnRequest[]; onRequest: (request: Omit<ReturnRequest, "id">) => void }) {
  const [open, setOpen] = useState(false);
  const [lineId, setLineId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<ReturnType<typeof validateReturn>>({});
  const [confirmation, setConfirmation] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const eligible = order.lines.filter(line => returnableQuantity(order, line.id, requests) > 0);
  const available = returnableQuantity(order, lineId, requests);

  function submit(event: FormEvent) {
    event.preventDefault();
    const draft = { lineId, quantity: Number(quantity), reason };
    const problems = validateReturn(order, requests, draft);
    setErrors(problems);
    if (Object.keys(problems).length) {
      const first = problems.lineId ? "return-item" : problems.quantity ? "return-quantity" : "return-reason";
      (formRef.current?.elements.namedItem(first) as HTMLElement | null)?.focus();
      return;
    }
    onRequest({ ...draft, orderId: order.id, status: "Awaiting review" });
    setConfirmation("Demo request created. Nothing was sent and no refund was issued.");
    setOpen(false);
  }

  return <section className="account-panel" aria-labelledby="return-title">
    <div className="account-section-heading"><div><h2 id="return-title">Returns</h2><p>Sample policy: delivered units within 14 days. Preview date: {orderDate(sampleToday)}.</p></div>
      {!open && <button className="account-button" disabled={!eligible.length} onClick={() => { setLineId(eligible[0]?.id ?? ""); setQuantity("1"); setReason(""); setErrors({}); setConfirmation(""); setOpen(true); }}>Start demo return</button>}
    </div>
    {confirmation && <p className="account-feedback" role="status">{confirmation}</p>}
    {!eligible.length && <p className="account-note">No delivered units are currently available for a new request.</p>}
    {open && <form className="account-return-form" ref={formRef} onSubmit={submit} noValidate>
      <label>Item<select name="return-item" value={lineId} aria-invalid={!!errors.lineId} aria-describedby={errors.lineId ? "return-item-error" : undefined} onChange={event => { setLineId(event.target.value); setQuantity("1"); }}>
        {eligible.map(line => <option key={line.id} value={line.id}>{line.name} · {returnableQuantity(order, line.id, requests)} available</option>)}
      </select>{errors.lineId && <span id="return-item-error" className="account-error">{errors.lineId}</span>}</label>
      <label>Quantity<input name="return-quantity" type="number" min="1" max={available} step="1" value={quantity} onChange={event => setQuantity(event.target.value)} aria-invalid={!!errors.quantity} aria-describedby={errors.quantity ? "return-quantity-error" : undefined} />{errors.quantity && <span id="return-quantity-error" className="account-error">{errors.quantity}</span>}</label>
      <label className="account-wide">Reason<select name="return-reason" value={reason} onChange={event => setReason(event.target.value)} aria-invalid={!!errors.reason} aria-describedby={errors.reason ? "return-reason-error" : undefined}><option value="">Choose a reason</option>{returnReasons.map(value => <option key={value}>{value}</option>)}</select>{errors.reason && <span id="return-reason-error" className="account-error">{errors.reason}</span>}</label>
      <div className="account-actions account-wide"><button className="account-button account-primary" type="submit">Create demo request</button><button className="account-text-button" type="button" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>}
  </section>;
}

function OrderDetail({ order, requests, onRequest, onCancel, onBack }: { order: CustomerOrder; requests: ReturnRequest[]; onRequest: (request: Omit<ReturnRequest, "id">) => void; onCancel: (id: string) => void; onBack: () => void }) {
  const totals = orderTotals(order);
  const orderRequests = requests.filter(request => request.orderId === order.id);
  return <div className="account-detail">
    <button className="account-text-button" onClick={onBack}>← All orders</button>
    <div className="account-detail-heading"><div><h2>Order {order.id}</h2><p>Placed {orderDate(order.placedOn)} · {orderStatus(order)}</p></div><strong>{money(totals.totalBeforeTax)}<small>Total before tax</small></strong></div>
    <section className="account-panel" aria-labelledby="items-title"><h2 id="items-title">Your items</h2><div className="account-lines">
      {order.lines.map(line => <div className="account-line" key={line.id}><ProductPhoto productId={line.productId} /><div><Link href={`/products/${line.productId}`}>{line.name}</Link><span>{line.color} · Qty {line.quantity} · {money(line.unitPrice)} each</span></div><strong>{money(line.unitPrice * line.quantity)}</strong></div>)}
    </div><dl className="account-totals"><div><dt>Merchandise</dt><dd>{money(totals.merchandise)}</dd></div><div><dt>Sample delivery</dt><dd>{money(totals.delivery)}</dd></div><div><dt>Sales tax</dt><dd>Not calculated</dd></div><div><dt>Total before tax</dt><dd>{money(totals.totalBeforeTax)}</dd></div></dl></section>
    <section aria-labelledby="parcels-title"><div className="account-section-heading"><div><h2 id="parcels-title">Your deliveries</h2><p>{order.parcels.length} {order.parcels.length === 1 ? "parcel" : "separate parcels"} · sample tracking events</p></div></div><div className="account-parcels">
      {order.parcels.map((parcel, index) => <article className="account-panel" key={parcel.id}><div className="account-parcel-heading"><h3>Parcel {index + 1} · {parcel.seller}</h3><span>{parcelStatus(parcel)}</span></div><ul className="account-parcel-items">{parcel.items.map(item => <li key={item.lineId}>{order.lines.find(line => line.id === item.lineId)?.name} × {item.quantity}</li>)}</ul>
        <ol className="account-timeline"><li className="is-complete"><strong>Order received</strong><span>{orderDate(order.placedOn)}</span></li><li className={parcel.shippedOn ? "is-complete" : ""}><strong>{parcel.shippedOn ? "Shipped" : "Preparing to ship"}</strong><span>{parcel.shippedOn ? orderDate(parcel.shippedOn) : "Waiting for the seller"}</span></li><li className={parcel.deliveredOn ? "is-complete" : ""}><strong>{parcel.deliveredOn ? "Delivered" : "Delivery"}</strong><span>{parcel.deliveredOn ? orderDate(parcel.deliveredOn) : parcel.estimatedDelivery ? `Estimated ${orderDate(parcel.estimatedDelivery)}` : "Date not available"}</span></li></ol>
        {parcel.deliveredOn && <p className="account-note">Sample return window ends {orderDate(returnWindowEnd(parcel.deliveredOn))}.</p>}
      </article>)}
    </div></section>
    <ReturnForm key={order.id} order={order} requests={requests} onRequest={onRequest} />
    {orderRequests.length > 0 && <section className="account-panel" aria-labelledby="requests-title"><h2 id="requests-title">Your demo requests</h2><div className="account-requests">{orderRequests.map(request => <article key={request.id}><div><strong>{request.id}</strong><span>{order.lines.find(line => line.id === request.lineId)?.name} · Qty {request.quantity}</span><span>{request.reason} · {request.status}</span></div>{request.status === "Awaiting review" && <button className="account-text-button" onClick={() => onCancel(request.id)}>Cancel demo request</button>}</article>)}</div></section>}
  </div>;
}

export function AccountView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("All orders");
  const [search, setSearch] = useState("");
  const [requests, setRequests] = useState<ReturnRequest[]>([]);
  const requestNumber = useRef(1);
  const contentRef = useRef<HTMLDivElement>(null);
  const selected = customerOrders.find(order => order.id === selectedId);
  const visibleOrders = customerOrders.filter(order => (filter === "All orders" || orderStatus(order) === filter) && `${order.id} ${order.lines.map(line => line.name).join(" ")}`.toLowerCase().includes(search.toLowerCase().trim()));

  function changeOrder(id: string | null) {
    setSelectedId(id);
    contentRef.current?.focus();
  }

  function addRequest(request: Omit<ReturnRequest, "id">) {
    const id = `DEMO-R${String(requestNumber.current++).padStart(3, "0")}`;
    setRequests(current => [...current, { ...request, id }]);
  }

  return <main id="main" className="account-page" data-ui>
    <div className="account-heading"><div><h1>Your account</h1><p>Your orders, from the first find to your front door.</p></div><Link href="/wishlist" className="account-text-button">View saved finds →</Link></div>
    <p className="account-demo">Sample account · These orders are separate from checkout. Return requests stay in this page session and reset on reload. Nothing is sent.</p>
    <div className="account-layout">
      <div className="account-content" ref={contentRef} tabIndex={-1} aria-label={selected ? `Order ${selected.id}` : "Your orders"}>
        {selected ? <OrderDetail order={selected} requests={requests} onRequest={addRequest} onCancel={id => setRequests(current => current.map(request => request.id === id ? { ...request, status: "Cancelled" } : request))} onBack={() => changeOrder(null)} /> : <>
          <div className="account-section-heading"><div><h2>Your orders</h2><p>{visibleOrders.length} of {customerOrders.length} sample orders</p></div><span className="account-note">As of {orderDate(sampleToday)}</span></div>
          <div className="account-filters"><label><span className="account-sr-only">Search orders</span><input type="search" placeholder="Search order or product" value={search} onChange={event => setSearch(event.target.value)} /></label><label><span className="account-sr-only">Order status</span><select value={filter} onChange={event => setFilter(event.target.value)}>{["All orders", "Preparing", "In transit", "Partially delivered", "Delivered"].map(status => <option key={status}>{status}</option>)}</select></label></div>
          <div className="account-order-list">{visibleOrders.map(order => <article className="account-order" key={order.id}><div className="account-order-head"><div><h3>{order.id}</h3><span>{orderDate(order.placedOn)}</span></div><span>{orderStatus(order)}</span></div><div className="account-order-body"><div className="account-order-photos">{order.lines.map(line => <ProductPhoto key={line.id} productId={line.productId} />)}</div><div className="account-order-description"><p>{order.lines.map(line => line.name).join(" · ")}</p><span>{order.lines.reduce((sum, line) => sum + line.quantity, 0)} items · {order.parcels.length} {order.parcels.length === 1 ? "parcel" : "parcels"}</span></div><strong>{money(orderTotals(order).totalBeforeTax)}<small>Before tax</small></strong></div><button className="account-text-button" onClick={() => changeOrder(order.id)}>View order {order.id} →</button></article>)}</div>
          {visibleOrders.length === 0 && <div className="account-empty"><h3>No orders match</h3><p>Try a different product or order status.</p><button className="account-text-button" onClick={() => { setSearch(""); setFilter("All orders"); }}>Reset filters</button></div>}
        </>}
      </div>
      <aside className="account-profile" aria-label="Sample customer profile"><span className="account-avatar" aria-hidden="true">AM</span><h2>{sampleCustomer.name}</h2><p>{sampleCustomer.email}</p><dl><div><dt>Default delivery address</dt><dd>{sampleCustomer.address.map(line => <span key={line}>{line}</span>)}</dd></div><div><dt>Account currency</dt><dd>USD · United States</dd></div></dl><Link href="/help">Shopping help →</Link></aside>
    </div>
  </main>;
}
