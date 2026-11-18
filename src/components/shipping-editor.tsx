"use client";

import { useState } from "react";
import { fieldErrorsFrom, formatPriceInput, parsePriceCents } from "@/lib/catalog-admin";
import { MAX_PICKUPS, MAX_RATES_PER_ZONE, MAX_ZONES, shippingConfigSchema, type ShippingConfig } from "@/lib/checkout-settings";
import { usStates } from "@/lib/checkout";
import { useHydrated } from "@/lib/use-hydrated";
import { OperationsShell } from "./operations";

type RateDraft = { id: string; name: string; price: string; freeOver: string; minDays: string; maxDays: string; active: boolean };
type ZoneDraft = { id: string; name: string; states: string[]; rates: RateDraft[] };
type PickupDraft = { id: string; name: string; address: string; instructions: string; states: string[]; active: boolean };
type Draft = { zones: ZoneDraft[]; pickups: PickupDraft[] };
type Settings = { version: number; config: ShippingConfig; updatedAt: string | null };

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const days = (value: number | null) => value === null ? "" : String(value);

function toDraft(config: ShippingConfig): Draft {
  return {
    zones: config.zones.map(zone => ({
      id: zone.id, name: zone.name, states: [...zone.states],
      rates: zone.rates.map(rate => ({
        id: rate.id, name: rate.name, price: formatPriceInput(rate.priceCents), freeOver: formatPriceInput(rate.freeOverCents),
        minDays: days(rate.minDays), maxDays: days(rate.maxDays), active: rate.active,
      })),
    })),
    pickups: config.pickups.map(pickup => ({ ...pickup, states: [...pickup.states] })),
  };
}

/** Converts the form back; unparseable numbers become NaN so the shared schema reports them. */
function toConfig(draft: Draft): unknown {
  const cents = (value: string) => parsePriceCents(value) ?? Number.NaN;
  const optionalCents = (value: string) => value.trim() === "" ? null : cents(value);
  const optionalDays = (value: string) => value.trim() === "" ? null : /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
  return {
    zones: draft.zones.map(zone => ({
      id: zone.id, name: zone.name, states: zone.states,
      rates: zone.rates.map(rate => ({
        id: rate.id, name: rate.name, priceCents: cents(rate.price), freeOverCents: optionalCents(rate.freeOver),
        minDays: optionalDays(rate.minDays), maxDays: optionalDays(rate.maxDays), active: rate.active,
      })),
    })),
    pickups: draft.pickups,
  };
}

function StateGrid({ label, selected, unavailable, onChange, invalid }: { label: string; selected: string[]; unavailable?: Map<string, string>; onChange: (states: string[]) => void; invalid?: boolean }) {
  return <fieldset className="shipping-states" aria-invalid={invalid || undefined}>
    <legend>{label} <span>{selected.length} selected</span></legend>
    <div>{usStates.map(state => {
      const owner = unavailable?.get(state);
      return <label key={state} title={owner ? `In ${owner}` : undefined} className={owner ? "is-taken" : ""}>
        <input type="checkbox" checked={selected.includes(state)} disabled={Boolean(owner)} onChange={event => onChange(event.target.checked ? [...selected, state] : selected.filter(item => item !== state))} />
        {state}
      </label>;
    })}</div>
  </fieldset>;
}

export function ShippingEditor({ initial }: { initial: Settings }) {
  const hydrated = useHydrated();
  const [version, setVersion] = useState(initial.version);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial.config));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  function change(next: Draft) { setDraft(next); setDirty(true); setFeedback(null); }
  const updateZone = (index: number, zone: Partial<ZoneDraft>) => change({ ...draft, zones: draft.zones.map((item, position) => position === index ? { ...item, ...zone } : item) });
  const updateRate = (zoneIndex: number, rateIndex: number, rate: Partial<RateDraft>) =>
    updateZone(zoneIndex, { rates: draft.zones[zoneIndex].rates.map((item, position) => position === rateIndex ? { ...item, ...rate } : item) });
  const updatePickup = (index: number, pickup: Partial<PickupDraft>) => change({ ...draft, pickups: draft.pickups.map((item, position) => position === index ? { ...item, ...pickup } : item) });
  const invalid = (key: string) => errors[key] ? { "aria-invalid": true as const } : {};
  const errorText = (key: string) => errors[key] ? <span className="editor-field-error">{errors[key]}</span> : null;

  async function save() {
    const parsed = shippingConfigSchema.safeParse(toConfig(draft));
    if (!parsed.success) {
      setErrors(fieldErrorsFrom(parsed.error));
      setFeedback({ tone: "error", text: "Check the highlighted fields." });
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const response = await fetch("/api/admin/shipping", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version, config: parsed.data }) });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setVersion(body.version);
        setDraft(toDraft(body.config));
        setDirty(false);
        setConflict(false);
        setFeedback({ tone: "ok", text: "Shipping settings saved. Checkout uses them right away." });
      } else {
        if (body.fieldErrors) setErrors(Object.fromEntries(Object.entries(body.fieldErrors as Record<string, string>).map(([key, value]) => [key.replace(/^config\./, ""), value])));
        setConflict(response.status === 409);
        setFeedback({ tone: "error", text: body.error ?? "We couldn't save the settings." });
      }
    } catch {
      setFeedback({ tone: "error", text: "We couldn't reach Cartiva. Your changes are still here." });
    }
    setSaving(false);
  }

  async function reload() {
    const response = await fetch("/api/admin/shipping", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      setFeedback({ tone: "error", text: "We couldn't load the latest settings. Try again in a moment." });
      return;
    }
    const body = await response.json() as Settings;
    setVersion(body.version);
    setDraft(toDraft(body.config));
    setErrors({});
    setDirty(false);
    setConflict(false);
    setFeedback({ tone: "ok", text: "Loaded the latest saved settings." });
  }

  return <OperationsShell workspace="shipping" connected>
    <div className="product-editor settings-editor">
      <div className="ops-page-heading"><div><h1>Shipping</h1><p>Where you deliver, what it costs, and where customers can pick up.</p></div>
        <div className="editor-save-controls"><span className="editor-draft-state">{dirty ? "Unsaved changes" : `Version ${version || "default"}`}</span><button className="editor-button editor-primary" onClick={save} disabled={!hydrated || saving || !dirty}>{saving ? "Saving…" : "Save shipping"}</button></div></div>
      {feedback && <p className={`editor-feedback ${feedback.tone === "error" ? "is-error" : ""}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.text} {conflict && <button className="editor-button" onClick={reload}>Replace my edits with the latest version</button>}</p>}
      {errors.zones && <p className="editor-error-summary">{errors.zones}</p>}

      {draft.zones.map((zone, zoneIndex) => {
        const taken = new Map<string, string>();
        draft.zones.forEach((other, otherIndex) => { if (otherIndex !== zoneIndex) other.states.forEach(state => taken.set(state, other.name || "another zone")); });
        const key = `zones.${zoneIndex}`;
        return <section className="editor-section" key={zone.id} aria-labelledby={`${zone.id}-title`}>
          <div className="editor-section-heading"><div><h2 id={`${zone.id}-title`}>{zone.name || "New zone"}</h2><p>Delivery zone · {zone.states.length} states</p></div>
            <button className="editor-remove" onClick={() => change({ ...draft, zones: draft.zones.filter((_, position) => position !== zoneIndex) })}>Remove zone</button></div>
          <div className="editor-field"><label htmlFor={`${zone.id}-name`}>Zone name</label><input id={`${zone.id}-name`} value={zone.name} maxLength={60} onChange={event => updateZone(zoneIndex, { name: event.target.value })} {...invalid(`${key}.name`)} />{errorText(`${key}.name`)}</div>
          <StateGrid label="States in this zone" selected={zone.states} unavailable={taken} onChange={states => updateZone(zoneIndex, { states })} invalid={Boolean(errors[`${key}.states`])} />{errorText(`${key}.states`)}
          <div className="shipping-rates">
            <div className="shipping-rate-head" aria-hidden="true"><span>Rate</span><span>Price</span><span>Free over</span><span>Days</span><span>On</span><span /></div>
            {zone.rates.map((rate, rateIndex) => {
              const rateKey = `${key}.rates.${rateIndex}`;
              return <fieldset className="shipping-rate" key={rate.id}><legend className="ops-sr-only">{rate.name || "New rate"}</legend>
                <label><span className="ops-sr-only">Rate name</span><input value={rate.name} maxLength={60} placeholder="Standard delivery" onChange={event => updateRate(zoneIndex, rateIndex, { name: event.target.value })} {...invalid(`${rateKey}.name`)} /></label>
                <label className="editor-price-input"><span>$</span><input inputMode="decimal" aria-label={`${rate.name || "Rate"} price`} value={rate.price} onChange={event => updateRate(zoneIndex, rateIndex, { price: event.target.value })} {...invalid(`${rateKey}.priceCents`)} /></label>
                <label className="editor-price-input"><span>$</span><input inputMode="decimal" aria-label={`${rate.name || "Rate"} free over amount`} placeholder="Never" value={rate.freeOver} onChange={event => updateRate(zoneIndex, rateIndex, { freeOver: event.target.value })} {...invalid(`${rateKey}.freeOverCents`)} /></label>
                <span className="shipping-days"><input inputMode="numeric" aria-label={`${rate.name || "Rate"} earliest business day`} value={rate.minDays} onChange={event => updateRate(zoneIndex, rateIndex, { minDays: event.target.value })} {...invalid(`${rateKey}.minDays`)} />–<input inputMode="numeric" aria-label={`${rate.name || "Rate"} latest business day`} value={rate.maxDays} onChange={event => updateRate(zoneIndex, rateIndex, { maxDays: event.target.value })} {...invalid(`${rateKey}.maxDays`)} /></span>
                <label className="shipping-toggle"><input type="checkbox" checked={rate.active} aria-label={`${rate.name || "Rate"} offered`} onChange={event => updateRate(zoneIndex, rateIndex, { active: event.target.checked })} /></label>
                <button className="editor-remove" disabled={zone.rates.length === 1} onClick={() => updateZone(zoneIndex, { rates: zone.rates.filter((_, position) => position !== rateIndex) })}>Remove</button>
                {[`${rateKey}.name`, `${rateKey}.priceCents`, `${rateKey}.freeOverCents`, `${rateKey}.minDays`, `${rateKey}.maxDays`, `${rateKey}.id`].map(field => errors[field] ? <span key={field} className="editor-field-error shipping-rate-error">{errors[field]}</span> : null)}
              </fieldset>;
            })}
            {errorText(`${key}.rates`)}
            <button className="editor-button" disabled={zone.rates.length >= MAX_RATES_PER_ZONE} onClick={() => updateZone(zoneIndex, { rates: [...zone.rates, { id: newId("rate"), name: "", price: "", freeOver: "", minDays: "", maxDays: "", active: true }] })}>Add rate</button>
          </div>
        </section>;
      })}
      <button className="editor-button shipping-add" disabled={draft.zones.length >= MAX_ZONES} onClick={() => change({ ...draft, zones: [...draft.zones, { id: newId("zone"), name: "", states: [], rates: [{ id: newId("rate"), name: "Standard delivery", price: "", freeOver: "", minDays: "", maxDays: "", active: true }] }] })}>Add delivery zone</button>

      <h2 className="shipping-group-title">Pickup points</h2>
      {draft.pickups.map((pickup, index) => {
        const key = `pickups.${index}`;
        return <section className="editor-section" key={pickup.id} aria-labelledby={`${pickup.id}-title`}>
          <div className="editor-section-heading"><div><h2 id={`${pickup.id}-title`}>{pickup.name || "New pickup point"}</h2><p>Free · offered to shoppers in the chosen states</p></div>
            <button className="editor-remove" onClick={() => change({ ...draft, pickups: draft.pickups.filter((_, position) => position !== index) })}>Remove pickup</button></div>
          <div className="editor-field-pair">
            <div className="editor-field"><label htmlFor={`${pickup.id}-name`}>Name</label><input id={`${pickup.id}-name`} value={pickup.name} maxLength={60} onChange={event => updatePickup(index, { name: event.target.value })} {...invalid(`${key}.name`)} />{errorText(`${key}.name`)}</div>
            <div className="editor-field"><label htmlFor={`${pickup.id}-address`}>Address</label><input id={`${pickup.id}-address`} value={pickup.address} maxLength={160} onChange={event => updatePickup(index, { address: event.target.value })} {...invalid(`${key}.address`)} />{errorText(`${key}.address`)}</div>
          </div>
          <div className="editor-field"><label htmlFor={`${pickup.id}-instructions`}>Instructions <span>Hours, what to bring</span></label><textarea id={`${pickup.id}-instructions`} value={pickup.instructions} maxLength={300} onChange={event => updatePickup(index, { instructions: event.target.value })} {...invalid(`${key}.instructions`)} />{errorText(`${key}.instructions`)}</div>
          <StateGrid label="Offer pickup to shoppers in" selected={pickup.states} onChange={states => updatePickup(index, { states })} invalid={Boolean(errors[`${key}.states`])} />{errorText(`${key}.states`)}
          <label className="shipping-active"><input type="checkbox" checked={pickup.active} onChange={event => updatePickup(index, { active: event.target.checked })} /> Offer this pickup point</label>
        </section>;
      })}
      <button className="editor-button shipping-add" disabled={draft.pickups.length >= MAX_PICKUPS} onClick={() => change({ ...draft, pickups: [...draft.pickups, { id: newId("pickup"), name: "", address: "", instructions: "", states: [], active: true }] })}>Add pickup point</button>
      <p className="ops-demo-note"><span aria-hidden="true">○</span>Each state belongs to one delivery zone. Free-over amounts use the bag total after discount codes. Orders keep the option and price they were placed with; changes here apply to new checkouts only.</p>
    </div>
  </OperationsShell>;
}
