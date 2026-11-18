"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { OperationsShell } from "@/components/operations";
import { categories, mediaLibrary } from "@/lib/catalog";
import { MAX_MEDIA, MAX_OPTION_GROUPS, MAX_VARIANTS, parsePriceCents, type AdminProduct, type ProductStatus } from "@/lib/catalog-admin";
import {
  colorValues, editorFromProduct, editorToInput, emptyEditor, mediaForLibraryImage, newVariant, validateEditor,
  type EditorState, type EditorVariant,
} from "@/lib/catalog-editor-state";
import { useHydrated } from "@/lib/use-hydrated";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const statusLabels: Record<ProductStatus, string> = { draft: "Draft", published: "Published", archived: "Archived" };
const statusHelp: Record<ProductStatus, string> = {
  draft: "Hidden from the store. Keep working until it is ready.",
  published: "Visible in the store and at the register once saved.",
  archived: "Hidden from the store and kept for records.",
};
type PendingAction = { type: "select"; id: string } | { type: "new" } | { type: "reset" } | { type: "leave"; href: string };
type SaveResponse = { product?: AdminProduct; error?: string; fieldErrors?: Record<string, string> };

export function ProductEditor({ initialProducts }: { initialProducts: AdminProduct[] }) {
  const hydrated = useHydrated();
  const [products, setProducts] = useState(initialProducts);
  const [draft, setDraft] = useState<EditorState>(() => initialProducts[0] ? editorFromProduct(initialProducts[0]) : emptyEditor(categories[0]));
  const [baseline, setBaseline] = useState(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "notice" | "error"; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const confirmationRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const allowLeave = useRef(false);
  const nextKey = useRef(1);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const saved = draft.id ? products.find(product => product.id === draft.id) : undefined;
  const prices = draft.variants.map(variant => parsePriceCents(variant.price)).filter((price): price is number => price !== null);
  const stocks = draft.variants.map(variant => /^\d+$/.test(variant.stock.trim()) ? Number(variant.stock) : null);
  const totalStock = stocks.every(stock => stock !== null) ? stocks.reduce<number>((sum, stock) => sum + (stock ?? 0), 0) : null;
  const cover = draft.media[0];
  const swatchValues = colorValues(draft);
  const grouped = (["published", "draft", "archived"] as const).map(status => ({ status, items: products.filter(product => product.status === status) }));

  useEffect(() => {
    if (pendingAction && !confirmationRef.current?.open) confirmationRef.current?.showModal();
  }, [pendingAction]);

  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      if (allowLeave.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    function beforeNavigation(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPendingAction({ type: "leave", href: url.href });
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeNavigation, true);
    };
  }, [dirty]);

  function open(next: EditorState) {
    setDraft(next);
    setBaseline(next);
    setErrors({});
    setMessage(null);
    setConflict(false);
  }

  function performAction(action: PendingAction) {
    if (action.type === "leave") {
      allowLeave.current = true;
      window.location.assign(action.href);
    } else if (action.type === "select") {
      const product = products.find(item => item.id === action.id);
      if (product) open(editorFromProduct(product));
    } else if (action.type === "new") {
      open(emptyEditor(categories[0]));
      requestAnimationFrame(() => document.getElementById("editor-name")?.focus());
    } else {
      setDraft(baseline);
      setErrors({});
      setMessage({ tone: "notice", text: "Unsaved changes discarded." });
    }
  }

  function requestAction(action: PendingAction) {
    if (dirty) setPendingAction(action);
    else performAction(action);
  }

  function confirmDiscard() {
    const action = pendingAction;
    confirmationRef.current?.close();
    if (action) performAction(action);
  }

  // Error keys are Zod paths such as `variants.0.options.1`; a field also owns its nested keys.
  const owns = (key: string, candidate: string) => candidate === key || candidate.startsWith(`${key}.`);

  function clearError(...keys: string[]) {
    setErrors(current => {
      const remaining = Object.entries(current).filter(([candidate]) => !keys.some(key => owns(key, candidate)));
      return remaining.length === Object.keys(current).length ? current : Object.fromEntries(remaining);
    });
  }

  function update(changes: Partial<EditorState>, ...errorKeys: string[]) {
    setDraft(current => ({ ...current, ...changes }));
    clearError(...errorKeys);
    setMessage(null);
  }

  /** Clears the list-level "variants" message only, keeping each variant's own field errors. */
  function clearVariantListError() {
    setErrors(current => "variants" in current ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== "variants")) : current);
  }

  function updateVariant(key: string, changes: Partial<EditorVariant>, field: string) {
    const index = draft.variants.findIndex(variant => variant.key === key);
    setDraft(current => ({ ...current, variants: current.variants.map(variant => variant.key === key ? { ...variant, ...changes } : variant) }));
    clearError(`variants.${index}.${field}`);
    clearVariantListError();
    setMessage(null);
  }

  function addVariant() {
    if (draft.variants.length >= MAX_VARIANTS) return;
    // "added-" never collides with saved variant IDs or the "new-1" row of an empty editor.
    const key = `added-${nextKey.current++}`;
    const last = draft.variants.at(-1);
    update({ variants: [...draft.variants, { ...newVariant(key, draft.optionNames.length, last?.mediaIds ?? draft.media.slice(0, 1).map(item => item.id)), price: last?.price ?? "" }] });
    clearVariantListError();
    requestAnimationFrame(() => document.getElementById(`editor-${key}-option-0`)?.focus());
  }

  function removeVariant(key: string) {
    if (draft.variants.length <= 1) return;
    update({ variants: draft.variants.filter(variant => variant.key !== key) });
    setErrors({});
  }

  function setOptionCount(count: number) {
    const optionNames = count > draft.optionNames.length ? [...draft.optionNames, ""] : draft.optionNames.slice(0, count);
    update({
      optionNames,
      variants: draft.variants.map(variant => ({ ...variant, options: Array.from({ length: count }, (_, index) => variant.options[index] ?? "") })),
    });
    setErrors({});
    if (count > 1) requestAnimationFrame(() => document.getElementById("editor-option-name-1")?.focus());
  }

  function togglePhoto(libraryId: string) {
    const item = mediaForLibraryImage(draft.media, libraryId);
    if (!item) return;
    const selected = draft.media.some(media => media.id === item.id);
    clearError(...draft.variants.map((_, index) => `variants.${index}.mediaIds`));
    if (selected) {
      update({
        media: draft.media.filter(media => media.id !== item.id),
        variants: draft.variants.map(variant => ({ ...variant, mediaIds: variant.mediaIds.filter(id => id !== item.id) })),
      }, "media");
    } else if (draft.media.length < MAX_MEDIA) {
      update({
        media: [...draft.media, item],
        variants: draft.variants.map(variant => variant.mediaIds.length ? variant : { ...variant, mediaIds: [item.id] }),
      }, "media");
    }
  }

  function toggleVariantPhoto(variant: EditorVariant, mediaId: string) {
    const mediaIds = variant.mediaIds.includes(mediaId)
      ? variant.mediaIds.filter(id => id !== mediaId)
      : draft.media.map(item => item.id).filter(id => id === mediaId || variant.mediaIds.includes(id));
    updateVariant(variant.key, { mediaIds }, "mediaIds");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || conflict) return;
    const { input, errors: nextErrors } = validateEditor(draft);
    setErrors(nextErrors);
    setMessage(null);
    if (!input) {
      setMessage({ tone: "error", text: "Review the highlighted fields before saving." });
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(draft.id ? `/api/admin/catalog/products/${encodeURIComponent(draft.id)}` : "/api/admin/catalog/products", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editorToInput(draft)),
      });
      const result: SaveResponse | null = await response.json().catch(() => null);
      if (!response.ok || !result?.product) {
        setErrors(result?.fieldErrors ?? {});
        // A duplicate SKU can be fixed in place; any other conflict needs the latest version first.
        if (response.status === 409 && !Object.keys(result?.fieldErrors ?? {}).some(key => key.endsWith(".sku"))) setConflict(true);
        setMessage({ tone: "error", text: response.status === 401 ? "Your session has ended. Sign in again to save." : result?.error ?? "The product could not be saved. Please try again." });
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return;
      }
      const product = result.product;
      setProducts(current => current.some(item => item.id === product.id) ? current.map(item => item.id === product.id ? product : item) : [...current, product]);
      open(editorFromProduct(product));
      setMessage({ tone: "notice", text: product.status === "published" ? `${product.name} saved. The store and register now show these details.` : `${product.name} saved as ${statusLabels[product.status].toLowerCase()}. It is not visible in the store.` });
    } catch {
      setMessage({ tone: "error", text: "We couldn’t connect. Your edits are still here; please try again." });
    } finally {
      setSaving(false);
    }
  }

  async function reloadLatest() {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/catalog/products", { cache: "no-store" });
      const result = await response.json().catch(() => null) as { products?: AdminProduct[] } | null;
      if (!response.ok || !result?.products) throw new Error();
      setProducts(result.products);
      const latest = draft.id ? result.products.find(item => item.id === draft.id) : undefined;
      open(latest ? editorFromProduct(latest) : result.products[0] ? editorFromProduct(result.products[0]) : emptyEditor(categories[0]));
      setMessage({ tone: "notice", text: "Latest saved version loaded." });
    } catch {
      setMessage({ tone: "error", text: "The latest version could not be loaded. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  function errorKey(key: string) {
    return key in errors ? key : Object.keys(errors).find(candidate => owns(key, candidate));
  }

  function errorFor(key: string) {
    const found = errorKey(key);
    return found ? <span className="editor-field-error" id={`editor-error-${key.replaceAll(".", "-")}`}>{errors[found]}</span> : null;
  }

  /** `messageKey` names the field whose message describes this control (defaults to `key`). */
  function validationProps(key: string, hintId?: string, messageKey = key) {
    const invalid = Boolean(errorKey(key)) || (messageKey !== key && messageKey in errors);
    const describedBy = [hintId, invalid ? `editor-error-${messageKey.replaceAll(".", "-")}` : undefined].filter(Boolean).join(" ");
    return { "aria-invalid": invalid, "aria-describedby": describedBy || undefined };
  }

  const stateLabel = conflict ? "Out of date" : dirty ? "Unsaved changes" : draft.id ? `${statusLabels[saved?.status ?? draft.status]} · saved` : "New product · not saved";

  return (
    <OperationsShell workspace="products" connected>
      <div className="product-editor">
        <div className="ops-page-heading editor-heading">
          <div>
            <h1>Product editor</h1>
            <p>Shape the Cartiva catalog. Published products appear in the store and at the register.</p>
          </div>
          <button type="button" className="editor-button" onClick={() => requestAction({ type: "new" })}>New product <span aria-hidden="true">+</span></button>
        </div>

        <div className="editor-toolbar">
          <div className="editor-product-picker">
            <label htmlFor="editor-product">Editing</label>
            <select id="editor-product" value={draft.id ?? "__new"} onChange={event => { if (event.target.value !== (draft.id ?? "__new")) requestAction({ type: "select", id: event.target.value }); }}>
              {!draft.id && <option value="__new">New product · not saved</option>}
              {grouped.filter(group => group.items.length).map(group => <optgroup key={group.status} label={statusLabels[group.status]}>
                {group.items.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
              </optgroup>)}
            </select>
          </div>
          <div className="editor-save-controls">
            <span className="editor-draft-state">{stateLabel}</span>
            <button type="button" className="editor-button editor-discard" disabled={!dirty || saving} onClick={() => requestAction({ type: "reset" })}>Discard changes</button>
            <button type="submit" form="product-editor-form" className="editor-button editor-primary" disabled={!hydrated || saving || conflict}>{saving ? "Saving…" : "Save product"}</button>
          </div>
        </div>
        <div className={`editor-feedback${message?.tone === "error" ? " is-error" : ""}`} role={message?.tone === "error" ? "alert" : "status"} aria-live="polite">
          {message?.text}
          {conflict && <button type="button" className="editor-button editor-reload" disabled={saving} onClick={() => void reloadLatest()}>Replace my edits with the latest version</button>}
        </div>

        <div className="editor-layout">
          <form id="product-editor-form" ref={formRef} method="post" onSubmit={save} noValidate className="editor-form" aria-busy={saving}>
            <section className="editor-section" aria-labelledby="editor-details-heading">
              <div className="editor-section-heading"><h2 id="editor-details-heading">Product details</h2><span>Required unless marked optional</span></div>
              <div className="editor-field">
                <label htmlFor="editor-name">Product name</label>
                <input id="editor-name" value={draft.name} onChange={event => update({ name: event.target.value }, "name")} maxLength={100} required {...validationProps("name")} />
                {errorFor("name")}
                {draft.slug && <span className="editor-hint">Store address: /products/{draft.slug}</span>}
              </div>
              <div className="editor-field">
                <label htmlFor="editor-description">Description</label>
                <textarea id="editor-description" value={draft.description} onChange={event => update({ description: event.target.value }, "description")} maxLength={1200} rows={3} required {...validationProps("description")} />
                {errorFor("description")}
              </div>
              <div className="editor-field">
                <label htmlFor="editor-details">Details <span>Optional · one per line, up to 8</span></label>
                <textarea id="editor-details" value={draft.details} onChange={event => update({ details: event.target.value }, "details")} rows={3} {...validationProps("details")} />
                {errorFor("details")}
              </div>
              <div className="editor-field-pair">
                <div className="editor-field">
                  <label htmlFor="editor-category">Category</label>
                  <select id="editor-category" value={draft.category} onChange={event => update({ category: event.target.value }, "category")} required {...validationProps("category")}>
                    {categories.map(category => <option key={category}>{category}</option>)}
                  </select>
                  {errorFor("category")}
                </div>
                <div className="editor-field">
                  <label htmlFor="editor-vendor">Seller</label>
                  <input id="editor-vendor" value={draft.vendor} onChange={event => update({ vendor: event.target.value }, "vendor")} list="editor-sellers" maxLength={80} required {...validationProps("vendor")} />
                  <datalist id="editor-sellers">{[...new Set(products.map(product => product.vendor))].map(vendor => <option key={vendor} value={vendor} />)}</datalist>
                  {errorFor("vendor")}
                </div>
              </div>
              <fieldset className="editor-status" aria-describedby="editor-status-help">
                <legend>Visibility</legend>
                <div className="editor-status-options">
                  {(["draft", "published", "archived"] as const).map(status => <label key={status} className={draft.status === status ? "is-selected" : ""}>
                    <input type="radio" name="editor-status" value={status} checked={draft.status === status} onChange={() => update({ status })} />
                    <span>{statusLabels[status]}</span>
                  </label>)}
                </div>
                <p id="editor-status-help" className="editor-help">{statusHelp[draft.status]}</p>
              </fieldset>
            </section>

            <section className="editor-section" aria-labelledby="editor-media-heading">
              <div className="editor-section-heading"><div><h2 id="editor-media-heading">Photos</h2><p>Choose up to {MAX_MEDIA} from the photo library. The first is the cover.</p></div><span>{draft.media.length} selected</span></div>
              <fieldset className="editor-media-options" aria-describedby={errors.media ? "editor-error-media" : undefined}>
                <legend className="ops-sr-only">Product photos</legend>
                {mediaLibrary.map(image => {
                  const position = draft.media.findIndex(item => item.src === image.src);
                  const selected = position >= 0;
                  return <label key={image.id} className={`editor-photo-option${selected ? " is-selected" : ""}`}>
                    <input type="checkbox" checked={selected} disabled={!selected && draft.media.length >= MAX_MEDIA} onChange={() => togglePhoto(image.id)} aria-label={`${image.label}${selected ? `, photo ${position + 1}` : ""}`} />
                    <Image src={image.src} alt="" width={100} height={100} />
                    <span>{selected && <b>{position + 1}</b>}{image.label}</span>
                  </label>;
                })}
              </fieldset>
              {errorFor("media")}
              <p className="editor-help">Uploads are not connected yet; these are the existing local photos.</p>
            </section>

            <section className="editor-section" aria-labelledby="editor-options-heading">
              <div className="editor-section-heading"><div><h2 id="editor-options-heading">Options</h2><p>Name what shoppers choose between, such as Color or Size.</p></div><span>{draft.optionNames.length} / {MAX_OPTION_GROUPS}</span></div>
              <div className="editor-option-names">
                {draft.optionNames.map((name, index) => <div className="editor-field" key={index}>
                  <label htmlFor={`editor-option-name-${index}`}>{index === 0 ? "First option" : "Second option"}</label>
                  <input id={`editor-option-name-${index}`} value={name} maxLength={24} onChange={event => update({ optionNames: draft.optionNames.map((item, position) => position === index ? event.target.value : item) }, `optionNames.${index}`)} {...validationProps(`optionNames.${index}`)} />
                  {errorFor(`optionNames.${index}`)}
                </div>)}
                <button type="button" className="editor-button" onClick={() => setOptionCount(draft.optionNames.length === 1 ? 2 : 1)}>{draft.optionNames.length === 1 ? "Add a second option +" : "Remove second option"}</button>
              </div>
              {swatchValues.length > 0 && <div className="editor-swatches">
                <h3>Color swatches <span>Optional</span></h3>
                <div>{swatchValues.map(value => <label key={value}>
                  <input type="color" value={draft.swatches[value] ?? "#8a8178"} onChange={event => update({ swatches: { ...draft.swatches, [value]: event.target.value } })} />
                  <span>{value}{draft.swatches[value] ? "" : " · not set"}</span>
                </label>)}</div>
              </div>}
            </section>

            <section className="editor-section" aria-labelledby="editor-variants-heading">
              <div className="editor-section-heading"><div><h2 id="editor-variants-heading">Variants, prices &amp; stock</h2><p>Each combination is its own SKU with its own price and on-hand stock.</p></div><span>{draft.variants.length} / {MAX_VARIANTS}</span></div>
              {errorFor("variants")}
              <div className="editor-variants">
                {draft.variants.map((variant, index) => {
                  const prefix = `variants.${index}`;
                  const label = variant.options.map(option => option.trim()).filter(Boolean).join(" · ") || `Variant ${index + 1}`;
                  return <fieldset className="editor-variant" key={variant.key}>
                    <legend>{label}{variant.id ? "" : " · new"}</legend>
                    <div className="editor-variant-grid">
                      {draft.optionNames.map((optionName, optionIndex) => <div className="editor-field" key={optionIndex}>
                        <label htmlFor={`editor-${variant.key}-option-${optionIndex}`}>{optionName.trim() || `Option ${optionIndex + 1}`}</label>
                        <input id={`editor-${variant.key}-option-${optionIndex}`} value={variant.options[optionIndex] ?? ""} maxLength={40} onChange={event => updateVariant(variant.key, { options: variant.options.map((value, position) => position === optionIndex ? event.target.value : value) }, "options")} {...validationProps(`${prefix}.options.${optionIndex}`, undefined, `${prefix}.options`)} />
                      </div>)}
                      <div className="editor-field editor-variant-sku">
                        <label htmlFor={`editor-${variant.key}-sku`}>SKU</label>
                        <input id={`editor-${variant.key}-sku`} value={variant.sku} maxLength={48} autoCapitalize="characters" spellCheck={false} onChange={event => updateVariant(variant.key, { sku: event.target.value }, "sku")} {...validationProps(`${prefix}.sku`)} />
                        {errorFor(`${prefix}.sku`)}
                      </div>
                    </div>
                    {errorFor(`${prefix}.options`)}
                    <div className="editor-variant-grid editor-variant-numbers">
                      <div className="editor-field">
                        <label htmlFor={`editor-${variant.key}-price`}>Price <span>USD</span></label>
                        <div className="editor-price-input"><span aria-hidden="true">$</span><input id={`editor-${variant.key}-price`} inputMode="decimal" value={variant.price} onChange={event => updateVariant(variant.key, { price: event.target.value }, "price")} {...validationProps(`${prefix}.price`)} /></div>
                        {errorFor(`${prefix}.price`)}
                      </div>
                      <div className="editor-field">
                        <label htmlFor={`editor-${variant.key}-compare`}>Compare at <span>Optional</span></label>
                        <div className="editor-price-input"><span aria-hidden="true">$</span><input id={`editor-${variant.key}-compare`} inputMode="decimal" value={variant.compareAt} onChange={event => updateVariant(variant.key, { compareAt: event.target.value }, "compareAtPrice")} {...validationProps(`${prefix}.compareAtPrice`)} /></div>
                        {errorFor(`${prefix}.compareAtPrice`)}
                      </div>
                      <div className="editor-field editor-variant-stock">
                        <label htmlFor={`editor-${variant.key}-stock`}>On hand</label>
                        <input id={`editor-${variant.key}-stock`} inputMode="numeric" value={variant.stock} maxLength={7} onChange={event => updateVariant(variant.key, { stock: event.target.value }, "stock")} {...validationProps(`${prefix}.stock`, variant.expectedStock !== null && variant.stock.trim() !== String(variant.expectedStock) ? `editor-${variant.key}-stock-change` : undefined)} />
                        {variant.expectedStock !== null && variant.stock.trim() !== String(variant.expectedStock) && /^\d+$/.test(variant.stock.trim()) && <span className="editor-hint" id={`editor-${variant.key}-stock-change`}>Adjustment {Number(variant.stock) - variant.expectedStock > 0 ? "+" : ""}{Number(variant.stock) - variant.expectedStock} from {variant.expectedStock}</span>}
                        {errorFor(`${prefix}.stock`)}
                      </div>
                    </div>
                    {draft.media.length > 0 && <div className="editor-variant-photos" role="group" aria-label={`Photos for ${label}`}>
                      {draft.media.map(item => <button type="button" key={item.id} aria-pressed={variant.mediaIds.includes(item.id)} onClick={() => toggleVariantPhoto(variant, item.id)}>{item.label}</button>)}
                    </div>}
                    {errorFor(`${prefix}.mediaIds`)}
                    <button type="button" className="editor-remove" aria-label={`Remove ${label}`} disabled={draft.variants.length === 1} onClick={() => removeVariant(variant.key)}>Remove</button>
                  </fieldset>;
                })}
              </div>
              <div className="editor-inventory-footer">
                <button type="button" className="editor-button" onClick={addVariant} disabled={draft.variants.length >= MAX_VARIANTS}>{draft.variants.length >= MAX_VARIANTS ? `${MAX_VARIANTS} variant limit reached` : "Add variant +"}</button>
                <span>Total on hand <strong>{totalStock === null ? "—" : totalStock.toLocaleString("en-US")}</strong><span> units</span></span>
              </div>
              <p className="editor-help">SKUs are unique across the catalog. Removing a saved variant archives it; its SKU and stock history are kept. Stock changes are recorded as adjustments by your account.</p>
            </section>
          </form>

          <aside className="editor-preview" aria-labelledby="editor-preview-heading">
            <div className="editor-section-heading"><h2 id="editor-preview-heading">Product preview</h2><span>{statusLabels[draft.status]}</span></div>
            <div className="editor-preview-image">{cover ? <Image src={cover.src} alt={cover.alt} fill sizes="(max-width: 700px) 90vw, (max-width: 1100px) 44vw, 360px" /> : <span className="editor-preview-empty">Choose a photo</span>}</div>
            <div className="editor-preview-copy">
              <p className="editor-preview-vendor">{draft.vendor.trim() || "Seller name"}</p>
              <h3>{draft.name.trim() || "Your product name"}</h3>
              <span className="editor-preview-category">{draft.category}</span>
              <p className="editor-preview-price">{prices.length ? (Math.min(...prices) === Math.max(...prices) ? currency.format(Math.min(...prices) / 100) : `${currency.format(Math.min(...prices) / 100)}–${currency.format(Math.max(...prices) / 100)}`) : "—"} <span>USD</span></p>
              <p className="editor-preview-description">{draft.description.trim() || "Add a description to tell the story of your product."}</p>
              <dl className="editor-preview-facts">
                <div><dt>Variants</dt><dd>{draft.variants.length}</dd></div>
                <div><dt>On hand</dt><dd>{totalStock === null ? "—" : `${totalStock.toLocaleString("en-US")} units`}</dd></div>
              </dl>
              <div className="editor-preview-colors">{draft.variants.map((variant, index) => <span key={variant.key}>{variant.options.map(option => option.trim()).filter(Boolean).join(" · ") || `Variant ${index + 1}`}</span>)}</div>
            </div>
            {saved?.status === "published" && !dirty ? <Link className="editor-preview-link" href={`/products/${saved.slug}`} target="_blank" rel="noopener">View in the store ↗</Link> : <p className="editor-preview-note">{draft.status === "published" ? "Saving publishes these details to the store and register." : "Not visible in the store."}</p>}
          </aside>
        </div>
        <dialog className="ops-dialog editor-confirmation" ref={confirmationRef} onCancel={() => setPendingAction(null)} onClose={() => setPendingAction(null)} aria-labelledby="editor-confirm-title" aria-describedby="editor-confirm-description">
          <h2 id="editor-confirm-title">{pendingAction?.type === "leave" ? "Leave without saving?" : "Discard product changes?"}</h2>
          <p id="editor-confirm-description">{pendingAction?.type === "leave" ? "Your unsaved changes will be lost when you leave this page." : `Your unsaved changes to ${draft.name.trim() || "this new product"} will be discarded. The last saved version stays in the catalog.`}</p>
          <div><button type="button" className="editor-button" onClick={() => confirmationRef.current?.close()}>Keep editing</button><button type="button" className="editor-button editor-primary" onClick={confirmDiscard}>{pendingAction?.type === "leave" ? "Discard and leave" : "Discard changes"}</button></div>
        </dialog>
      </div>
    </OperationsShell>
  );
}
