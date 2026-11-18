"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Product } from "@/lib/catalog";
import { sampleProducts as products } from "@/lib/sample-catalog";

type OrderStatus = "To pack" | "In transit" | "Delivered";
type OrderLine = { product: Product; quantity: number };
type SampleOrder = {
  id: string;
  customer: string;
  city: string;
  day: number;
  channel: "Online" | "In store";
  status: OrderStatus;
  lines: OrderLine[];
};
type Workspace = "admin" | "orders" | "shipping" | "coupons" | "products" | "content" | "seller-applications" | "vendor" | "pos";
type IconName = "overview" | "store" | "register" | "product" | "content" | "arrow" | "search" | "close" | "plus" | "minus" | "bag" | "check" | "truck" | "tag";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (cents: number) => currency.format(cents / 100);
const lineTotal = (lines: OrderLine[]) => lines.reduce((total, line) => total + line.product.price * line.quantity, 0);

const sampleOrders: SampleOrder[] = [
  { id: "CV-1048", customer: "Maya Bennett", city: "Portland, OR", day: 7, channel: "Online", status: "To pack", lines: [{ product: products[0], quantity: 1 }, { product: products[3], quantity: 1 }] },
  { id: "CV-1047", customer: "Oliver Chen", city: "Austin, TX", day: 7, channel: "Online", status: "To pack", lines: [{ product: products[1], quantity: 2 }] },
  { id: "CV-1046", customer: "Sofia Reyes", city: "Seattle, WA", day: 6, channel: "In store", status: "Delivered", lines: [{ product: products[2], quantity: 1 }, { product: products[4], quantity: 1 }] },
  { id: "CV-1045", customer: "Elliot Brooks", city: "Denver, CO", day: 5, channel: "Online", status: "In transit", lines: [{ product: products[0], quantity: 2 }] },
  { id: "CV-1044", customer: "Nina Patel", city: "Brooklyn, NY", day: 4, channel: "Online", status: "In transit", lines: [{ product: products[5], quantity: 1 }, { product: products[1], quantity: 1 }] },
  { id: "CV-1043", customer: "Amir Hassan", city: "Chicago, IL", day: 3, channel: "In store", status: "Delivered", lines: [{ product: products[3], quantity: 2 }] },
  { id: "CV-1042", customer: "Clara Wilson", city: "Boston, MA", day: 2, channel: "Online", status: "Delivered", lines: [{ product: products[2], quantity: 1 }] },
  { id: "CV-1041", customer: "Leo Martin", city: "San Diego, CA", day: 1, channel: "Online", status: "Delivered", lines: [{ product: products[4], quantity: 2 }, { product: products[0], quantity: 1 }] },
];

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    store: <><path d="M3 10h18l-2-6H5l-2 6Zm1 0v10h16V10M9 20v-6h6v6" /><path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" /></>,
    register: <><rect x="4" y="3" width="16" height="12" rx="2" /><path d="M8 8h8M12 15v4m-5 2h10" /></>,
    product: <><path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10 9-5M3 8l9 5v9M7.5 5.5l9 5" /></>,
    content: <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M8 7h8M8 11h8M8 15h4" /></>,
    arrow: <path d="m7 17 10-10M7 7h10v10" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    bag: <><path d="M5 7h14l1 14H4L5 7Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    truck: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
    tag: <><path d="M3 12V4h8l10 10-8 8-10-10Z" /><circle cx="7.5" cy="7.5" r="1.4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function OperationsShell({ workspace, children, connected = false, storeName }: { workspace: Workspace; children: ReactNode; connected?: boolean; storeName?: string }) {
  const persisted = connected || workspace === "seller-applications";
  const destinations: { id: Workspace; href: string; title: string; shortTitle: string; icon: IconName }[] = [
    { id: "admin", href: "/admin", title: "Store overview", shortTitle: "Overview", icon: "overview" },
    { id: "orders", href: "/admin/orders", title: "Orders", shortTitle: "Orders", icon: "bag" },
    { id: "shipping", href: "/admin/shipping", title: "Shipping", shortTitle: "Shipping", icon: "truck" },
    { id: "coupons", href: "/admin/coupons", title: "Discount codes", shortTitle: "Codes", icon: "tag" },
    { id: "products", href: "/admin/products", title: "Product editor", shortTitle: "Products", icon: "product" },
    { id: "content", href: "/admin/content", title: "Store content", shortTitle: "Content", icon: "content" },
    { id: "seller-applications", href: "/admin/seller-applications", title: "Seller applications", shortTitle: "Requests", icon: "check" },
    { id: "vendor", href: "/vendor", title: "Seller workspace", shortTitle: "Sellers", icon: "store" },
    { id: "pos", href: "/pos", title: "Point of sale", shortTitle: "Register", icon: "register" },
  ];
  return (
    <div className={`ops-shell ops-${workspace}`}>
      <a className="ops-skip" href="#operations-main">Skip to workspace</a>
      <aside className="ops-sidebar">
        <Link href="/" className="ops-brand" aria-label="Cartiva storefront">cartiva<span aria-hidden="true">.</span></Link>
        <div className="ops-scope"><span className="ops-scope-mark">C</span><div>{storeName ?? "Cartiva collective"}<span>{persisted ? "Local workspace" : "Sample workspace"}</span></div></div>
        <span className="ops-nav-label">Workspace</span>
        <nav aria-label="Operations">
          {destinations.filter(destination => !connected || workspace !== "vendor" || destination.id === "vendor").map((destination) => <Link key={destination.id} href={destination.href} aria-label={destination.title} className={workspace === destination.id ? "is-active" : ""} aria-current={workspace === destination.id ? "page" : undefined}><Icon name={destination.icon} /><span className="ops-nav-full">{destination.title}</span><span className="ops-nav-short" aria-hidden="true">{destination.shortTitle}</span>{workspace === destination.id && <span className="ops-nav-dot" />}</Link>)}
        </nav>
        <div className="ops-sidebar-bottom"><p>Thoughtfully chosen.<br />Simply managed.</p><Link href="/">Visit storefront <Icon name="arrow" size={16} /></Link>{persisted ? <Link href="/account">Your account <Icon name="arrow" size={16} /></Link> : <div className="ops-profile"><span>CB</span><div>Cartiva team<small>Design preview</small></div></div>}</div>
      </aside>
      <div className="ops-workspace">
        <header className="ops-topbar"><span>Workspace <span className="ops-slash">/</span> <strong>{destinations.find((item) => item.id === workspace)?.title}</strong></span><div><span className="ops-demo-label">{persisted ? "Local preview" : "Sample data"}</span><Link href="/">Storefront <Icon name="arrow" size={15} /></Link></div></header>
        <main id="operations-main" className="ops-main">{children}</main>
      </div>
    </div>
  );
}

function Status({ status }: { status: OrderStatus }) {
  return <span className={`ops-status ${status === "To pack" ? "needs-action" : ""}`}><span aria-hidden="true" />{status}</span>;
}

function DemoNote({ children }: { children?: ReactNode }) {
  return <p className="ops-demo-note"><span aria-hidden="true">○</span>{children ?? <>Sample orders for exploring this overview. Real storefront orders are listed under <Link href="/admin/orders">Orders</Link>.</>}</p>;
}

function OrderDialog({ order, dialogRef, onClose }: { order: SampleOrder | null; dialogRef: RefObject<HTMLDialogElement | null>; onClose: () => void }) {
  useEffect(() => {
    if (order && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [order, dialogRef]);
  return (
    <dialog ref={dialogRef} className="ops-dialog" onClose={onClose} aria-labelledby="order-dialog-title">
      {order && <><div className="ops-dialog-heading"><div><span className="ops-muted">Sample order</span><h2 id="order-dialog-title">{order.id}</h2></div><button className="ops-icon-button" onClick={() => { dialogRef.current?.close(); onClose(); }} aria-label="Close order details"><Icon name="close" /></button></div><div className="ops-order-context"><div><strong>{order.customer}</strong><span>{order.city}</span></div><div><span>November {order.day}, 2026</span><Status status={order.status} /></div></div><div className="ops-dialog-lines">{order.lines.map(({ product, quantity }) => <div key={product.id}><Image src={product.image} alt={product.imageAlt} width={64} height={64} /><div><strong>{product.name}</strong><span>{product.vendor} · Qty {quantity}</span></div><strong>{money(product.price * quantity)}</strong></div>)}</div><div className="ops-order-total"><span>Merchandise total</span><strong>{money(lineTotal(order.lines))}</strong></div><p className="ops-muted">Paid · sample record · {order.channel}. Shipping and tax are excluded from these example totals.</p><DemoNote>No customer data or real payment is connected to this preview.</DemoNote></>}
    </dialog>
  );
}

function SalesChart({ metric }: { metric: "sales" | "orders" }) {
  const values = Array.from({ length: 7 }, (_, index) => sampleOrders.filter((order) => order.day === index + 1).reduce((sum, order) => sum + (metric === "sales" ? lineTotal(order.lines) / 100 : 1), 0));
  const maximum = metric === "sales" ? Math.ceil(Math.max(...values) / 100) * 100 : Math.ceil((Math.max(...values) + 1) / 2) * 2;
  const chartWidth = 600;
  const chartHeight = 136;
  const points = values.map((value, index) => `${52 + index * 86},${18 + chartHeight - value / maximum * chartHeight}`).join(" ");
  return <div className="ops-chart"><svg viewBox={`0 0 ${chartWidth} 194`} role="img" aria-labelledby="sales-chart-title sales-chart-desc"><title id="sales-chart-title">{`${metric === "sales" ? "Sample merchandise sales" : "Sample order count"}, November 1–7`}</title><desc id="sales-chart-desc">{values.map((value, index) => `November ${index + 1}: ${metric === "sales" ? currency.format(value) : `${value} orders`}`).join(". ")}</desc>{[0, 0.5, 1].map((fraction) => { const y = 18 + chartHeight * (1 - fraction); return <g key={fraction}><line x1="52" x2="570" y1={y} y2={y} className="ops-chart-grid" /><text x="40" y={y + 4} textAnchor="end" className="ops-chart-label">{metric === "sales" ? `$${maximum * fraction}` : maximum * fraction}</text></g>; })}<polyline points={points} fill="none" className="ops-chart-line" />{values.map((value, index) => <g key={index}><circle cx={52 + index * 86} cy={18 + chartHeight - value / maximum * chartHeight} r="3" className="ops-chart-point" /><text x={52 + index * 86} y="181" textAnchor="middle" className="ops-chart-label">Nov {index + 1}</text></g>)}</svg></div>;
}

export function AdminOverview({ catalog }: { catalog: Product[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All orders");
  const [metric, setMetric] = useState<"sales" | "orders">("sales");
  const [selectedOrder, setSelectedOrder] = useState<SampleOrder | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const total = sampleOrders.reduce((sum, order) => sum + lineTotal(order.lines), 0);
  const toPack = sampleOrders.filter((order) => order.status === "To pack");
  const visibleOrders = sampleOrders.filter((order) => (status === "All orders" || order.status === status) && `${order.id} ${order.customer}`.toLowerCase().includes(search.toLowerCase()));
  const channelTotals = ["Online", "In store"].map((channel) => ({ channel, total: sampleOrders.filter((order) => order.channel === channel).reduce((sum, order) => sum + lineTotal(order.lines), 0) }));
  const openOrder = (order: SampleOrder) => setSelectedOrder(order);

  return <OperationsShell workspace="admin">
    <div className="ops-page-heading"><div><h1>Store overview</h1><p>A clear view of what&apos;s moving, and what needs you.</p></div><span className="ops-period">Nov 1–7, 2026 <span>USD</span></span></div>
    <div className="ops-kpi-row"><div><span>Merchandise sales</span><strong>{money(total)}</strong><small>Across {sampleOrders.length} sample orders</small></div><div><span>Orders to pack</span><strong>{toPack.length}</strong><small>{money(toPack.reduce((sum, order) => sum + lineTotal(order.lines), 0))} ready for fulfillment</small></div><div><span>Average order</span><strong>{money(Math.round(total / sampleOrders.length))}</strong><small>Merchandise value per order</small></div><div><span>Products in catalog</span><strong>{catalog.length}</strong><small>Published · from {new Set(catalog.map((product) => product.vendor)).size} {new Set(catalog.map((product) => product.vendor)).size === 1 ? "maker" : "makers"}</small></div></div>
    <div className="ops-overview-grid"><section className="ops-panel ops-sales-panel"><div className="ops-section-heading"><div><h2>Sales at a glance</h2><p>One week, across both channels.</p></div><div className="ops-segmented" aria-label="Chart metric"><button aria-pressed={metric === "sales"} className={metric === "sales" ? "is-active" : ""} onClick={() => setMetric("sales")}>Sales</button><button aria-pressed={metric === "orders"} className={metric === "orders" ? "is-active" : ""} onClick={() => setMetric("orders")}>Orders</button></div></div><SalesChart metric={metric} /><div className="ops-channel-summary">{channelTotals.map((channel) => <div key={channel.channel}><span>{channel.channel}</span><strong>{money(channel.total)}</strong></div>)}</div></section>
      <section className="ops-panel ops-attention"><div className="ops-section-heading"><div><h2>Ready to go</h2><p>The next orders on your list.</p></div><span className="ops-count">{toPack.length}</span></div><div className="ops-pack-list">{toPack.map((order) => <button key={order.id} onClick={() => openOrder(order)}><Image src={order.lines[0].product.image} alt="" width={52} height={60} /><span><strong>{order.id}</strong><small>{order.customer}</small><span>{order.lines.reduce((sum, line) => sum + line.quantity, 0)} items · {money(lineTotal(order.lines))}</span></span><Icon name="arrow" size={16} /></button>)}</div><button className="ops-text-button" onClick={() => { setStatus("To pack"); document.getElementById("orders")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Review orders to pack <Icon name="arrow" size={15} /></button></section></div>
    <section id="orders" className="ops-orders-section"><div className="ops-section-heading"><div><h2>Orders</h2><p>Every detail, from checkout to doorstep.</p></div><span className="ops-muted">{visibleOrders.length} of {sampleOrders.length} orders</span></div><div className="ops-list-toolbar"><div className="ops-tabs" aria-label="Order status">{["All orders", "To pack", "In transit", "Delivered"].map((item) => <button key={item} aria-pressed={status === item} className={status === item ? "is-active" : ""} onClick={() => setStatus(item)}>{item}</button>)}</div><label className="ops-search"><Icon name="search" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an order or customer" aria-label="Search orders by number or customer" /></label></div><div className="ops-table-wrap"><table className="ops-orders-table"><thead><tr><th>Order / Customer</th><th>Date</th><th>Channel</th><th>Status</th><th className="ops-number">Total</th><th><span className="ops-sr-only">Details</span></th></tr></thead><tbody>{visibleOrders.map((order) => <tr key={order.id}><td><button className="ops-order-link" onClick={() => openOrder(order)}>{order.id}</button><span className="ops-cell-sub">{order.customer}</span></td><td>Nov {order.day}, 2026</td><td>{order.channel}</td><td><Status status={order.status} /></td><td className="ops-number">{money(lineTotal(order.lines))}</td><td><button className="ops-icon-button" aria-label={`View order ${order.id}`} onClick={() => openOrder(order)}><Icon name="arrow" size={16} /></button></td></tr>)}</tbody></table>{visibleOrders.length === 0 && <div className="ops-empty"><strong>No matching orders</strong><span>Try another name or choose a different status.</span><button className="ops-text-button" onClick={() => { setSearch(""); setStatus("All orders"); }}>Clear filters</button></div>}</div></section><DemoNote /><OrderDialog order={selectedOrder} dialogRef={dialogRef} onClose={() => setSelectedOrder(null)} />
  </OperationsShell>;
}

export function VendorOverview() {
  const vendors = [...new Set(products.map((product) => product.vendor))];
  const [vendor, setVendor] = useState(vendors.includes("Form & Field") ? "Form & Field" : vendors[0]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const vendorOrders = sampleOrders.map((order) => ({ ...order, lines: order.lines.filter((line) => line.product.vendor === vendor) })).filter((order) => order.lines.length > 0);
  const settlements = vendorOrders.map((order) => { const gross = lineTotal(order.lines); const fee = Math.round(gross * 0.1); return { order, gross, fee, net: gross - fee }; });
  const gross = settlements.reduce((sum, record) => sum + record.gross, 0);
  const fees = settlements.reduce((sum, record) => sum + record.fee, 0);
  const available = settlements.filter((record) => record.order.status === "Delivered").reduce((sum, record) => sum + record.net, 0);
  const pending = gross - fees - available;
  const vendorProducts = products.filter((product) => product.vendor === vendor);
  return <OperationsShell workspace="vendor"><div className="ops-page-heading"><div><h1>Seller earnings</h1><p>Your share of every order, clearly accounted for.</p></div><label className="ops-vendor-select"><span>Sample seller</span><select value={vendor} onChange={(event) => setVendor(event.target.value)}>{vendors.map((name) => <option key={name}>{name}</option>)}</select></label></div>
    <div className="ops-vendor-grid"><section className="ops-panel ops-balance-panel"><div className="ops-section-heading"><div><h2>Available in this preview</h2><p>{vendor} · November 1–7</p></div><Icon name="store" size={22} /></div><strong className="ops-balance">{money(available)}</strong><p>Net earnings on delivered sample orders.</p><div className="ops-balance-track"><span style={{ width: `${gross ? available / (gross - fees) * 100 : 0}%` }} /></div><div className="ops-balance-legend"><span><i />Available</span><span><i />Awaiting fulfillment</span></div><div className="ops-balance-bottom"><span>Awaiting fulfillment<strong>{money(pending)}</strong></span><span>Actual transfers<strong>{money(0)}</strong></span></div><span className="ops-transfer-note">Payouts are not connected in this design preview.</span></section>
      <section className="ops-panel ops-earnings-panel"><div className="ops-section-heading"><div><h2>From sale to earnings</h2><p>Example commission: 10% per order.</p></div></div><div className="ops-earnings-lines"><div><span>Merchandise sold</span><strong>{money(gross)}</strong></div><div><span>Platform commission</span><strong>−{money(fees)}</strong></div><div className="ops-net-line"><span>Your net earnings</span><strong>{money(gross - fees)}</strong></div></div><button className="ops-text-button" onClick={() => setShowBreakdown(!showBreakdown)} aria-expanded={showBreakdown}>{showBreakdown ? "Hide calculation" : "How earnings are calculated"}<Icon name={showBreakdown ? "minus" : "plus"} size={15} /></button>{showBreakdown && <p className="ops-calculation">Each sample order deducts a 10% commission, rounded to the nearest cent. Delivered orders count as available; the rest remain pending. Shipping, tax, refunds and payment-provider fees are excluded.</p>}</section></div>
    <section className="ops-orders-section"><div className="ops-section-heading"><div><h2>Order breakdown</h2><p>Only {vendor}&apos;s items appear in these totals.</p></div><span className="ops-muted">{settlements.length} orders · USD</span></div><div className="ops-table-wrap"><table className="ops-settlement-table"><thead><tr><th>Order</th><th>Fulfillment</th><th className="ops-number">Sales</th><th className="ops-number">Commission</th><th className="ops-number">Net earnings</th></tr></thead><tbody>{settlements.map(({ order, gross: orderGross, fee, net }) => <tr key={order.id}><td><strong>{order.id}</strong><span className="ops-cell-sub">Nov {order.day}, 2026</span></td><td><Status status={order.status} /></td><td className="ops-number">{money(orderGross)}</td><td className="ops-number ops-muted">−{money(fee)}</td><td className="ops-number">{money(net)}</td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Total</td><td className="ops-number">{money(gross)}</td><td className="ops-number">−{money(fees)}</td><td className="ops-number">{money(gross - fees)}</td></tr></tfoot></table>{settlements.length === 0 && <div className="ops-empty"><strong>No sample orders for this seller</strong><span>Choose another sample seller to explore the earnings breakdown.</span></div>}</div></section>
    <section className="ops-seller-products"><div className="ops-section-heading"><div><h2>Behind the numbers</h2><p>{vendorProducts.length} considered pieces in your catalog.</p></div></div><div>{vendorProducts.slice(0, 3).map((product) => <Link key={product.id} href={`/products/${product.slug}`}><Image src={product.image} alt={product.imageAlt} width={76} height={82} /><span><strong>{product.name}</strong><small>{money(product.price)}</small></span><Icon name="arrow" size={16} /></Link>)}</div></section><DemoNote>All earnings are calculated from sample orders. No payout account, bank transfer or live ledger is connected.</DemoNote>
  </OperationsShell>;
}

/** Sells each published product's default variant, using live prices and that variant's stock. */
export function PosRegister({ catalog }: { catalog: Product[] }) {
  const products = catalog.map((product) => ({ ...product, price: product.variants[0].price, stock: product.variants[0].stock }));
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All products");
  const [cart, setCart] = useState<OrderLine[]>([]);
  const [receipt, setReceipt] = useState<OrderLine[]>([]);
  const [notice, setNotice] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const receiptRef = useRef<HTMLDialogElement>(null);
  const categories = ["All products", ...new Set(products.map((product) => product.category))];
  const displayedProducts = products.filter((product) => (category === "All products" || category === product.category) && `${product.name} ${product.vendor}`.toLowerCase().includes(search.toLowerCase()));
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = lineTotal(cart);
  const addProduct = (product: Product) => {
    const current = cart.find((line) => line.product.id === product.id)?.quantity ?? 0;
    if (current >= product.stock) { setNotice(`Only ${product.stock} ${product.name} available.`); return; }
    setCart((lines) => {
      const quantity = lines.find((line) => line.product.id === product.id)?.quantity ?? 0;
      if (quantity >= product.stock) return lines;
      return quantity ? lines.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line) : [...lines, { product, quantity: 1 }];
    });
    setNotice(`${product.name} added to the sale.`);
  };
  const decreaseProduct = (id: string) => setCart((lines) => lines.flatMap((line) => line.product.id !== id ? [line] : line.quantity > 1 ? [{ ...line, quantity: line.quantity - 1 }] : []));
  const previewReceipt = () => { setReceipt(cart.map((line) => ({ ...line }))); receiptRef.current?.showModal(); };
  const clearCart = () => { setCart([]); setNotice("The current sale has been cleared."); };

  return <OperationsShell workspace="pos"><div className="ops-page-heading"><div><h1>A good day at the counter.</h1><p>Point of sale · Cartiva studio · Local preview</p></div><span className="ops-register-indicator"><span />Demo register</span></div>
    <div className="ops-pos-layout"><section className="ops-pos-catalog" aria-label="Products for the current sale"><label className="ops-search ops-pos-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products or makers" aria-label="Search products or makers" /></label><div className="ops-tabs ops-pos-tabs" aria-label="Product category">{categories.map((item) => <button key={item} aria-pressed={category === item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="ops-product-grid">{displayedProducts.map((product) => { const quantity = cart.find((line) => line.product.id === product.id)?.quantity ?? 0; return <button key={product.id} className="ops-pos-product" onClick={() => addProduct(product)} disabled={quantity >= product.stock} aria-label={`Add ${product.name}, ${money(product.price)} to sale`}><div className="ops-product-image"><Image src={product.image} alt={product.imageAlt} width={240} height={240} sizes="(max-width: 620px) 45vw, (max-width: 1100px) 28vw, 18vw" />{quantity > 0 && <span className="ops-quantity-mark">{quantity} in sale</span>}<span className="ops-product-add"><Icon name="plus" size={17} /></span></div><div className="ops-product-caption"><small>{product.vendor}</small><h2>{product.name}</h2><strong>{money(product.price)}</strong></div></button>; })}</div>{displayedProducts.length === 0 && <div className="ops-empty"><strong>No products found</strong><span>Try a different name or category.</span><button className="ops-text-button" onClick={() => { setSearch(""); setCategory("All products"); }}>Clear filters</button></div>}</section>
      <aside className={`ops-sale-panel ${cartOpen ? "is-open" : ""}`} aria-label="Current sale"><div className="ops-sale-heading"><div><h2>Current sale</h2><span>{count} {count === 1 ? "item" : "items"}</span></div><button className="ops-icon-button ops-mobile-close" aria-label="Close current sale" onClick={() => setCartOpen(false)}><Icon name="close" /></button>{count > 0 && <button className="ops-text-button" onClick={clearCart}>Clear</button>}</div><div className="ops-customer"><span className="ops-customer-avatar">G</span><div><strong>Guest customer</strong><small>Walk-in · No account needed</small></div></div><div className="ops-sale-lines">{cart.length ? cart.map(({ product, quantity }) => <div className="ops-sale-line" key={product.id}><Image src={product.image} alt="" width={56} height={64} /><div><strong>{product.name}</strong><small>{money(product.price)} each</small><div className="ops-stepper"><button onClick={() => decreaseProduct(product.id)} aria-label={`Decrease ${product.name} quantity`}><Icon name="minus" size={14} /></button><span>{quantity}</span><button onClick={() => addProduct(product)} disabled={quantity >= product.stock} aria-label={`Increase ${product.name} quantity`}><Icon name="plus" size={14} /></button></div></div><strong className="ops-number">{money(product.price * quantity)}</strong></div>) : <div className="ops-sale-empty"><Icon name="bag" size={32} /><strong>Start with something good.</strong><span>Choose a product to build<br />your first sample sale.</span></div>}</div><div className="ops-sale-summary"><div><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div><span>Tax</span><span>Not configured</span></div><div className="ops-sale-total"><span>Preview total</span><strong>{money(subtotal)}</strong></div><button className="ops-primary" disabled={!cart.length} onClick={previewReceipt}>Preview sale <span>{money(subtotal)}</span></button><p>Creates a sample receipt only.<br />No payment or order will be processed.</p></div></aside></div>
    <span className="ops-sr-only" role="status" aria-live="polite">{notice}</span><button className="ops-mobile-cart" onClick={() => setCartOpen(true)}><span>Current sale · {count} items</span><strong>{money(subtotal)}</strong></button><DemoNote>Prices and stock come from the published catalog (default variant). This register keeps a separate temporary cart; quantities reset when you leave, and stock and payments are not updated.</DemoNote>
    <dialog ref={receiptRef} className="ops-dialog ops-receipt" aria-labelledby="receipt-title"><div className="ops-dialog-heading"><span className="ops-demo-label">Sample receipt</span><button className="ops-icon-button" onClick={() => receiptRef.current?.close()} aria-label="Close sample receipt"><Icon name="close" /></button></div><span className="ops-receipt-brand">cartiva.</span><h2 id="receipt-title">A little preview of checkout.</h2><p>No charge. No order placed.</p><div className="ops-receipt-lines">{receipt.map(({ product, quantity }) => <div key={product.id}><span>{quantity} × {product.name}</span><strong>{money(product.price * quantity)}</strong></div>)}</div><div className="ops-order-total"><span>Merchandise total</span><strong>{money(lineTotal(receipt))}</strong></div><p className="ops-muted">Tax and payment collection are not configured.</p><button className="ops-primary" onClick={() => { clearCart(); setCartOpen(false); receiptRef.current?.close(); }}>Start a new sample sale <Icon name="arrow" size={16} /></button><button className="ops-text-button" onClick={() => receiptRef.current?.close()}>Back to current sale</button></dialog>
  </OperationsShell>;
}
