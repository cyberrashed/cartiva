"use client";

import { useRef, useState } from "react";
import { fieldErrorsFrom, formatPriceInput, parsePriceCents } from "@/lib/catalog-admin";
import { couponInputSchema, describeCoupon, type CouponKind } from "@/lib/checkout-settings";
import { money } from "@/lib/cart";
import { useHydrated } from "@/lib/use-hydrated";
import { OperationsShell } from "./operations";

export type AdminCouponView = {
  id: string; version: number; code: string; kind: CouponKind; percentOff: number | null; amountOffCents: number | null;
  minSubtotalCents: number; startsAt: string | null; endsAt: string | null; usageLimit: number | null; active: boolean;
  state: "live" | "scheduled" | "ended" | "used_up" | "off"; usedCount: number; redeemedCount: number; heldCount: number;
};
type Form = { id: string | null; version: number; code: string; kind: CouponKind; value: string; minimum: string; startsAt: string; endsAt: string; limit: string; active: boolean };

const kindLabels: Record<CouponKind, string> = { percent: "Percentage off", fixed: "Amount off", free_shipping: "Free delivery" };
const emptyForm: Form = { id: null, version: 0, code: "", kind: "percent", value: "", minimum: "", startsAt: "", endsAt: "", limit: "", active: true };
const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** ISO → the browser's local "YYYY-MM-DDTHH:mm" for datetime-local inputs. */
function localInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const stateLabels: Record<AdminCouponView["state"], string> = { live: "Live", scheduled: "Scheduled", ended: "Ended", used_up: "Used up", off: "Off" };

export function CouponManager({ initialCoupons }: { initialCoupons: AdminCouponView[] }) {
  const hydrated = useHydrated();
  const [coupons, setCoupons] = useState(initialCoupons);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function open(next: Form) {
    setForm(next);
    setErrors({});
    setFeedback(null);
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>("input")?.focus());
  }
  function edit(coupon: AdminCouponView) {
    open({
      id: coupon.id, version: coupon.version, code: coupon.code, kind: coupon.kind,
      value: coupon.kind === "percent" ? String(coupon.percentOff ?? "") : coupon.kind === "fixed" ? formatPriceInput(coupon.amountOffCents) : "",
      minimum: coupon.minSubtotalCents ? formatPriceInput(coupon.minSubtotalCents) : "", startsAt: localInput(coupon.startsAt), endsAt: localInput(coupon.endsAt),
      limit: coupon.usageLimit === null ? "" : String(coupon.usageLimit), active: coupon.active,
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    const whole = (value: string) => /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
    const candidate = {
      version: form.version, code: form.code, kind: form.kind,
      percentOff: form.kind === "percent" ? whole(form.value) : null,
      amountOffCents: form.kind === "fixed" ? parsePriceCents(form.value) ?? Number.NaN : null,
      minSubtotalCents: form.minimum.trim() ? parsePriceCents(form.minimum) ?? Number.NaN : 0,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      usageLimit: form.limit.trim() ? whole(form.limit) : null,
      active: form.active,
    };
    const parsed = couponInputSchema.safeParse(candidate);
    if (!parsed.success) { setErrors(fieldErrorsFrom(parsed.error)); return; }
    setSaving(true);
    try {
      const response = await fetch(form.id ? `/api/admin/coupons/${form.id}` : "/api/admin/coupons", {
        method: form.id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        const list = await fetch("/api/admin/coupons", { cache: "no-store" }).then(result => result.json()) as AdminCouponView[];
        setCoupons(list);
        setForm(null);
        setFeedback({ tone: "ok", text: `${body.code} saved.` });
      } else {
        setErrors(body.fieldErrors ?? {});
        setFeedback({ tone: "error", text: body.error ?? "We couldn't save this code." });
      }
    } catch {
      setFeedback({ tone: "error", text: "We couldn't reach Cartiva. Your changes are still here." });
    }
    setSaving(false);
  }

  const field = (key: keyof typeof errors) => errors[key] ? { "aria-invalid": true as const, "aria-describedby": `coupon-${String(key)}-error` } : {};
  const message = (key: string) => errors[key] ? <span id={`coupon-${key}-error`} className="editor-field-error">{errors[key]}</span> : null;

  return <OperationsShell workspace="coupons" connected>
    <div className="product-editor settings-editor">
      <div className="ops-page-heading"><div><h1>Discount codes</h1><p>One code per order. Limits count open checkouts, so a code is never oversold.</p></div>
        <button className="editor-button editor-primary" disabled={!hydrated} onClick={() => open(emptyForm)}>New code</button></div>
      {feedback && <p className={`editor-feedback ${feedback.tone === "error" ? "is-error" : ""}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text}</p>}

      {form && <form ref={formRef} className="editor-section coupon-form" onSubmit={save} noValidate>
        <div className="editor-section-heading"><div><h2>{form.id ? `Edit ${form.code}` : "New code"}</h2><p>Codes are not case-sensitive for shoppers.</p></div></div>
        <div className="editor-field-pair">
          <div className="editor-field"><label htmlFor="coupon-code">Code</label><input id="coupon-code" value={form.code} maxLength={32} autoCapitalize="characters" onChange={event => setForm({ ...form, code: event.target.value.toUpperCase() })} {...field("code")} />{message("code")}</div>
          <div className="editor-field"><label htmlFor="coupon-kind">Type</label><select id="coupon-kind" value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value as CouponKind, value: "" })}>{(Object.keys(kindLabels) as CouponKind[]).map(kind => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select></div>
        </div>
        <div className="editor-field-pair">
          {form.kind !== "free_shipping" ? <div className="editor-field"><label htmlFor="coupon-value">{form.kind === "percent" ? "Percent off" : "Amount off"}</label><div className={form.kind === "fixed" ? "editor-price-input" : ""}>{form.kind === "fixed" && <span>$</span>}<input id="coupon-value" inputMode="decimal" value={form.value} onChange={event => setForm({ ...form, value: event.target.value })} {...field(form.kind === "percent" ? "percentOff" : "amountOffCents")} /></div>{message(form.kind === "percent" ? "percentOff" : "amountOffCents")}</div>
            : <div className="editor-field"><label>Value</label><p className="editor-help">Makes every delivery rate free. Pickup is already free.</p></div>}
          <div className="editor-field"><label htmlFor="coupon-minimum">Minimum bag <span>Optional</span></label><div className="editor-price-input"><span>$</span><input id="coupon-minimum" inputMode="decimal" value={form.minimum} onChange={event => setForm({ ...form, minimum: event.target.value })} {...field("minSubtotalCents")} /></div>{message("minSubtotalCents")}</div>
        </div>
        <div className="editor-field-pair">
          <div className="editor-field"><label htmlFor="coupon-starts">Starts <span>Optional, your local time</span></label><input id="coupon-starts" type="datetime-local" value={form.startsAt} onChange={event => setForm({ ...form, startsAt: event.target.value })} {...field("startsAt")} />{message("startsAt")}</div>
          <div className="editor-field"><label htmlFor="coupon-ends">Ends <span>Optional</span></label><input id="coupon-ends" type="datetime-local" value={form.endsAt} onChange={event => setForm({ ...form, endsAt: event.target.value })} {...field("endsAt")} />{message("endsAt")}</div>
        </div>
        <div className="editor-field-pair">
          <div className="editor-field"><label htmlFor="coupon-limit">Total uses <span>Empty for no limit</span></label><input id="coupon-limit" inputMode="numeric" value={form.limit} onChange={event => setForm({ ...form, limit: event.target.value })} {...field("usageLimit")} />{message("usageLimit")}</div>
          <div className="editor-field"><label>Availability</label><label className="shipping-active"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> Shoppers can use this code</label></div>
        </div>
        <div className="coupon-actions"><button type="submit" className="editor-button editor-primary" disabled={saving}>{saving ? "Saving…" : "Save code"}</button><button type="button" className="editor-button" onClick={() => setForm(null)}>Cancel</button></div>
      </form>}

      <section className="ops-orders-section"><div className="ops-table-wrap"><table className="ops-orders-table"><thead><tr><th>Code</th><th>Discount</th><th>Conditions</th><th>Status</th><th className="ops-number">Uses</th><th><span className="ops-sr-only">Edit</span></th></tr></thead>
        <tbody>{coupons.map(coupon => <tr key={coupon.id}>
          <td><strong>{coupon.code}</strong></td>
          <td>{describeCoupon(coupon)}</td>
          <td><span className="ops-cell-sub">{coupon.minSubtotalCents ? `Bags of ${money(coupon.minSubtotalCents)}+` : "Any bag"}{coupon.startsAt ? ` · from ${when.format(new Date(coupon.startsAt))}` : ""}{coupon.endsAt ? ` · until ${when.format(new Date(coupon.endsAt))}` : ""}</span></td>
          <td><span className={`ops-status ${coupon.state === "live" ? "" : "needs-action"}`}><span aria-hidden="true" />{stateLabels[coupon.state]}</span></td>
          <td className="ops-number">{coupon.redeemedCount}{coupon.usageLimit !== null ? ` / ${coupon.usageLimit}` : ""}{coupon.heldCount ? <span className="ops-cell-sub">{coupon.heldCount} in open checkouts</span> : null}</td>
          <td><button className="ops-text-button" onClick={() => edit(coupon)} aria-label={`Edit ${coupon.code}`}>Edit</button></td>
        </tr>)}</tbody></table>
        {coupons.length === 0 && <div className="ops-empty"><strong>No discount codes yet</strong><span>Create a code to offer a percentage, an amount or free delivery.</span></div>}</div></section>
      <p className="ops-demo-note"><span aria-hidden="true">○</span>Discounts reduce the merchandise total before delivery and are booked as sales discounts in the ledger. Stripe shows the code on its payment page.</p>
    </div>
  </OperationsShell>;
}
