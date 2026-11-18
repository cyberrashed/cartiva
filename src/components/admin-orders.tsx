"use client";

import Link from "next/link";
import { useState } from "react";
import { money } from "@/lib/cart";
import { fulfillmentStatusLabels, orderStatusLabels, paymentStatusLabels, type OrderDTO, type OrderStatus } from "@/lib/checkout";
import { OperationsShell } from "./operations";

const tabs: { id: "all" | OrderStatus; label: string }[] = [
  { id: "all", label: "All checkouts" },
  { id: "placed", label: "Placed" },
  { id: "pending_payment", label: "Holding stock" },
  { id: "canceled", label: "Canceled" },
];
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function AdminOrders({ orders }: { orders: OrderDTO[] }) {
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("all");
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = orders.filter(order => (tab === "all" || order.status === tab)
    && (!query || `${order.number} ${order.email} ${order.shipping.name} ${order.lines.map(line => line.sku).join(" ")}`.toLowerCase().includes(query)));
  const placed = orders.filter(order => order.status === "placed");
  const holding = orders.filter(order => order.status === "pending_payment");
  const review = placed.filter(order => order.reviewReason);
  return <OperationsShell workspace="orders" connected>
    <div className="ops-page-heading"><div><h1>Orders</h1><p>Every storefront checkout, from stock hold to verified payment.</p></div><span className="ops-period">Stripe sandbox <span>USD</span></span></div>
    <div className="ops-kpi-row">
      <div><span>Placed orders</span><strong>{placed.length}</strong><small>Paid and confirmed by Stripe</small></div>
      <div><span>Collected</span><strong>{money(placed.reduce((sum, order) => sum + order.totalCents, 0))}</strong><small>Sandbox payments, before fees</small></div>
      <div><span>Holding stock</span><strong>{holding.length}</strong><small>Checkouts awaiting payment</small></div>
      <div><span>Needs review</span><strong>{review.length}</strong><small>{review.length ? "Payment details to check" : "Nothing to check"}</small></div>
    </div>
    <section className="ops-orders-section"><div className="ops-list-toolbar"><div className="ops-tabs" aria-label="Order status">{tabs.map(item => <button key={item.id} aria-pressed={tab === item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div><label className="ops-search"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Order, email, name or SKU" aria-label="Search orders by number, email, name or SKU" /></label></div>
      <div className="ops-table-wrap"><table className="ops-orders-table"><thead><tr><th>Order / Customer</th><th>Created</th><th>Status</th><th>Payment</th><th className="ops-number">Items</th><th className="ops-number">Total</th></tr></thead><tbody>{visible.map(order => <tr key={order.id}>
        <td><Link className="ops-order-link" href={`/admin/orders/${order.number}`}>{order.number}</Link><span className="ops-cell-sub">{order.shipping.name} · {order.email}</span></td>
        <td>{day.format(new Date(order.createdAt))}</td>
        <td><span className={`ops-status ${order.reviewReason ? "needs-action" : ""}`}><span aria-hidden="true" />{order.reviewReason ? "Needs review" : orderStatusLabels[order.status]}</span>{order.status === "placed" && <span className="ops-cell-sub">{fulfillmentStatusLabels[order.fulfillmentStatus]}</span>}</td>
        <td><span className={`ops-status ${order.paymentStatus === "awaiting" ? "needs-action" : ""}`}><span aria-hidden="true" />{paymentStatusLabels[order.paymentStatus]}</span></td>
        <td className="ops-number">{order.lines.reduce((sum, line) => sum + line.quantity, 0)}</td>
        <td className="ops-number">{money(order.totalCents)}</td>
      </tr>)}</tbody></table>
      {visible.length === 0 && <div className="ops-empty"><strong>{orders.length ? "No matching orders" : "No checkouts yet"}</strong><span>{orders.length ? "Try another search or status." : "Orders appear here as soon as a customer starts paying."}</span>{orders.length > 0 && <button className="ops-text-button" onClick={() => { setSearch(""); setTab("all"); }}>Clear filters</button>}</div>}</div>
    </section>
    <p className="ops-demo-note"><span aria-hidden="true">○</span>Checkouts that are not paid within 30 minutes are canceled and their stock is released. Sales tax is not collected, and fulfillment and refunds arrive in a later phase.</p>
  </OperationsShell>;
}
