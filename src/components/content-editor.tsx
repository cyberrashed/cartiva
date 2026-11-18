"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OperationsShell } from "@/components/operations";
import { sampleProducts as products } from "@/lib/sample-catalog";
import { money } from "@/lib/cart";
import {
  CONTENT_FIELDS,
  CONTENT_LIMITS,
  CONTENT_STORAGE_KEY,
  readContentSnapshot,
  validateContent,
  type ContentDraft,
  type ContentSection,
  type ContentSnapshot,
} from "@/lib/content-draft";

const sections: Record<ContentSection, { title: string; description: string }> = {
  contexts: { title: "Shopping contexts", description: "At home, at work, on the move" },
  catalog: { title: "The everyday edit", description: "The first eight sample products" },
  footer: { title: "Store footer", description: "Brand story and shopping links" },
};
const contexts = [
  { title: "At home", description: "Objects that make a room feel like yours." },
  { title: "At work", description: "A little focus. A better everyday setup." },
  { title: "On the move", description: "Useful companions for wherever the day goes." },
];
const subscribeToHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;
const sameContent = (first: ContentDraft, second: ContentDraft) => JSON.stringify(first) === JSON.stringify(second);
const savedTime = (date: string | null) => date ? new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Sample starting content";

function Arrow({ direction }: { direction: "up" | "down" | "right" }) {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === "up" ? "M12 19V5m-5 5 5-5 5 5" : direction === "down" ? "M12 5v14m-5-5 5 5 5-5" : "M5 12h14m-5-5 5 5-5 5"} /></svg>;
}

function StorefrontPreview({ draft, device }: { draft: ContentDraft; device: "desktop" | "mobile" }) {
  return <div className={`ce-preview ce-preview-${device}`} aria-label={`Read-only ${device} storefront preview`}>
    <div className="ce-preview-nav"><span className="ce-preview-wordmark">cartiva</span><span>Collection</span><span>Bag (0)</span></div>
    <div className="ce-preview-hero"><div><h3>{draft.heading || "Add a headline"}</h3><p>{draft.description || "Add supporting copy to introduce the collection."}</p><span className="ce-preview-action">{draft.action || "Add an action label"}<Arrow direction="right" /></span></div><Image src="/images/editorial-room.jpg" alt="Soft daylight in a quiet contemporary living room" width={640} height={750} sizes="(max-width: 720px) 80vw, 35vw" /></div>
    {draft.sections.filter((section) => section.visible).map((section) => {
      if (section.id === "contexts") return <section className="ce-preview-contexts" key={section.id} aria-label="Shopping contexts preview"><h3>Find your everyday.</h3><div>{contexts.map((context) => <div key={context.title}><strong>{context.title}</strong><p>{context.description}</p></div>)}</div></section>;
      if (section.id === "catalog") return <section className="ce-preview-catalog" key={section.id} aria-label="Product collection preview"><div><h3>The everyday edit</h3><span>View the collection</span></div><p>A few good finds. Plenty of ways to make them yours.</p><div className="ce-preview-products">{products.slice(0, 8).map((product) => <div key={product.id}><Image src={product.image} alt={product.imageAlt} width={210} height={240} sizes="(max-width: 720px) 40vw, 15vw" /><span>{product.name}</span><strong>{money(product.price)}</strong></div>)}</div></section>;
      return <section className="ce-preview-footer" key={section.id} aria-label="Store footer preview"><Image src="/images/editorial-room.jpg" alt="A sunlit living room" width={400} height={400} sizes="(max-width: 720px) 80vw, 20vw" /><div><span className="ce-preview-wordmark">cartiva</span><h3>A place for<br />good things.</h3><span>Shop the collection</span><span>Your saved finds</span><span>Shopping help</span><p>United States · USD<br />Cartiva design preview.</p></div></section>;
    })}
    {draft.sections.every((section) => !section.visible) && <p className="ce-preview-empty">All optional sections are hidden. The hero stays visible.</p>}
  </div>;
}

function loadContent() {
  try {
    return { snapshot: readContentSnapshot(localStorage.getItem(CONTENT_STORAGE_KEY)), error: "" };
  } catch {
    return { snapshot: readContentSnapshot(null), error: "Saved content could not be loaded. Starting content is shown; it will replace the stored version only if you save." };
  }
}

function EditorWorkspace() {
  const [initial] = useState(loadContent);
  const [snapshot, setSnapshot] = useState(initial.snapshot);
  const [draft, setDraft] = useState(initial.snapshot.draft);
  const [device, setDevice] = useState<"desktop" | "mobile">(() => window.matchMedia("(max-width: 1000px)").matches ? "mobile" : "desktop");
  const [phonePane, setPhonePane] = useState<"edit" | "preview">("edit");
  const [notice, setNotice] = useState("");
  const [storageError, setStorageError] = useState(initial.error);
  const [confirmation, setConfirmation] = useState<{ type: "restore" } | { type: "leave"; href: string } | null>(null);
  const confirmationRef = useRef<HTMLDialogElement>(null);
  const allowLeave = useRef(false);
  const errors = validateContent(draft);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = !sameContent(draft, snapshot.draft);
  const differsFromPublished = !sameContent(draft, snapshot.published);

  useEffect(() => {
    if (confirmation && !confirmationRef.current?.open) confirmationRef.current?.showModal();
  }, [confirmation]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (allowLeave.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const checkLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setConfirmation({ type: "leave", href: destination.href });
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", checkLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", checkLink, true);
    };
  }, [dirty]);

  function persist(next: ContentSnapshot) {
    try {
      localStorage.setItem(CONTENT_STORAGE_KEY, JSON.stringify(next));
      setSnapshot(next);
      setStorageError("");
      return true;
    } catch {
      setStorageError("This browser could not save the content. Your edits are still on screen. Allow browser storage and try again.");
      return false;
    }
  }

  function checkDraft() {
    const firstError = Object.keys(errors)[0];
    if (!firstError) return true;
    setPhonePane("edit");
    setNotice("Fix the highlighted fields before saving or publishing a demo.");
    requestAnimationFrame(() => document.getElementById(`ce-${firstError}`)?.focus());
    return false;
  }

  function saveDraft() {
    if (!checkDraft()) return;
    if (persist({ ...snapshot, draft, savedAt: new Date().toISOString() })) setNotice("Draft saved in this browser. The public storefront is unchanged.");
  }

  function publishDemo() {
    if (!checkDraft()) return;
    const timestamp = new Date().toISOString();
    if (persist({ version: 1, draft, published: draft, savedAt: timestamp, publishedAt: timestamp })) setNotice("Demo snapshot published in this browser. The public storefront is unchanged.");
  }

  function moveSection(id: ContentSection, offset: -1 | 1) {
    setDraft((current) => {
      const index = current.sections.findIndex((section) => section.id === id);
      const next = [...current.sections];
      const target = index + offset;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, sections: next };
    });
    setNotice(`${sections[id].title} moved ${offset < 0 ? "up" : "down"} in the preview.`);
  }

  function confirmAction() {
    if (confirmation?.type === "leave") {
      allowLeave.current = true;
      window.location.assign(confirmation.href);
      return;
    }
    if (persist({ ...snapshot, draft: snapshot.published, savedAt: new Date().toISOString() })) {
      setDraft(snapshot.published);
      setNotice("Draft restored to the latest demo snapshot and saved in this browser.");
    }
    confirmationRef.current?.close();
  }

  return <div className="ce-editor">
    <div className="ops-page-heading ce-heading"><div><h1>Storefront content</h1><p>Shape the first impression. See every change as you make it.</p></div><div className="ce-heading-actions"><button className="ce-button" disabled={!dirty} onClick={saveDraft}>Save draft</button><button className="ce-button ce-button-primary" disabled={!differsFromPublished && snapshot.publishedAt !== null} onClick={publishDemo}>Publish demo<Arrow direction="right" /></button></div></div>
    <div className="ce-status-bar"><span className={dirty ? "ce-dirty" : ""}><i aria-hidden="true" />{dirty ? "Unsaved changes" : snapshot.savedAt ? "Draft saved locally" : "Starting sample content"}</span><span>{savedTime(snapshot.savedAt)}</span><span>Public storefront unchanged</span></div>
    <p className="ce-announcement" role="status">{notice}</p>
    {storageError && <p className="ce-storage-error" role="alert">{storageError}</p>}
    <div className="ce-phone-tabs" role="group" aria-label="Editor view"><button aria-pressed={phonePane === "edit"} onClick={() => setPhonePane("edit")}>Edit content</button><button aria-pressed={phonePane === "preview"} onClick={() => setPhonePane("preview")}>Preview changes</button></div>
    <div className="ce-layout" data-phone-pane={phonePane}>
      <div className="ce-controls">
        <section className="ce-panel" aria-labelledby="ce-hero-title"><div className="ce-panel-heading"><h2 id="ce-hero-title">Hero copy</h2><span>Always visible</span></div><p className="ce-help">A short introduction, one clear next step.</p>
          <form noValidate onSubmit={(event) => { event.preventDefault(); saveDraft(); }}>
            {(Object.keys(CONTENT_FIELDS) as (keyof typeof CONTENT_FIELDS)[]).map((field) => <div className="ce-field" key={field}><label htmlFor={`ce-${field}`}>{CONTENT_FIELDS[field]}</label>{field === "description" ? <textarea id={`ce-${field}`} rows={3} value={draft[field]} aria-invalid={!!errors[field]} aria-describedby={`ce-${field}-help`} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} /> : <input id={`ce-${field}`} value={draft[field]} aria-invalid={!!errors[field]} aria-describedby={`ce-${field}-help`} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />}<div className={`ce-field-help ${errors[field] ? "ce-field-error" : ""}`} id={`ce-${field}-help`}><span>{errors[field] ?? (field === "heading" ? "Keep it short enough for two lines." : field === "action" ? "Links to the collection in the design." : "One sentence about the collection.")}</span><span>{draft[field].length}/{CONTENT_LIMITS[field]}</span></div></div>)}
            <button className="ce-hidden-submit" type="submit" tabIndex={-1} aria-hidden="true">Save draft</button>
          </form>
        </section>
        <section className="ce-panel" aria-labelledby="ce-sections-title"><div className="ce-panel-heading"><h2 id="ce-sections-title">Page sections</h2><span>{draft.sections.filter((section) => section.visible).length} of 3 shown</span></div><p className="ce-help">Arrange the sections below the hero.</p><ol className="ce-sections">{draft.sections.map((section, index) => <li key={section.id}><div className="ce-section-label"><strong>{sections[section.id].title}</strong><span>{sections[section.id].description}</span></div><div className="ce-section-controls"><label className="ce-visibility"><input type="checkbox" checked={section.visible} aria-label={`Show ${sections[section.id].title}`} onChange={(event) => { const visible = event.target.checked; setDraft((current) => ({ ...current, sections: current.sections.map((item) => item.id === section.id ? { ...item, visible } : item) })); }} /><span>{section.visible ? "Shown" : "Hidden"}</span></label><div className="ce-move"><button aria-label={`Move ${sections[section.id].title} up`} disabled={index === 0} onClick={() => moveSection(section.id, -1)}><Arrow direction="up" /></button><button aria-label={`Move ${sections[section.id].title} down`} disabled={index === draft.sections.length - 1} onClick={() => moveSection(section.id, 1)}><Arrow direction="down" /></button></div></div></li>)}</ol></section>
        <section className="ce-publishing" aria-labelledby="ce-publish-title"><h2 id="ce-publish-title">Demo snapshot</h2><p>{snapshot.publishedAt ? `Published locally ${savedTime(snapshot.publishedAt)}.` : "The starting content is your first demo snapshot."}</p><button className="ce-text-button" disabled={!differsFromPublished} onClick={() => setConfirmation({ type: "restore" })}>Restore demo-published version</button><p className="ce-storage-note">Save and publish use this browser&apos;s local storage. They survive reloads until browser data is cleared. Unsaved edits can be lost when leaving. Nothing here updates the public storefront.</p></section>
      </div>
      <section className="ce-preview-panel" aria-labelledby="ce-preview-title"><div className="ce-preview-toolbar"><div><h2 id="ce-preview-title">Draft preview</h2><span>Read-only · updates as you type</span></div><div className="ce-device-switch" role="group" aria-label="Preview layout"><button aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>Desktop</button><button aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>Mobile</button></div></div>{hasErrors && <p className="ce-preview-warning">This draft needs a correction before it can be saved or demo-published.</p>}<div className="ce-preview-stage" tabIndex={0} role="region" aria-label="Scrollable storefront preview"><StorefrontPreview draft={draft} device={device} /></div><p className="ce-preview-note">An isolated layout preview using the sample collection. Navigation and shopping are inactive here. The desktop canvas scrolls on small screens.</p></section>
    </div>
    <dialog className="ops-dialog ce-confirmation" ref={confirmationRef} onClose={() => setConfirmation(null)} aria-labelledby="ce-confirm-title" aria-describedby="ce-confirm-description"><h2 id="ce-confirm-title">{confirmation?.type === "leave" ? "Leave without saving?" : "Restore the demo snapshot?"}</h2><p id="ce-confirm-description">{confirmation?.type === "leave" ? "Your unsaved changes will be lost. The last saved draft will still be here when you return." : "This replaces your current draft with the latest demo-published version and saves it in this browser. The public storefront stays unchanged."}</p><div><button className="ce-button" onClick={() => confirmationRef.current?.close()}>Keep editing</button><button className="ce-button ce-button-primary" onClick={confirmAction}>{confirmation?.type === "leave" ? "Discard and leave" : "Restore draft"}</button></div></dialog>
  </div>;
}

export function ContentEditor() {
  const hydrated = useSyncExternalStore(subscribeToHydration, hydratedSnapshot, serverSnapshot);
  return <OperationsShell workspace="content">{hydrated ? <EditorWorkspace /> : <div className="ce-editor ce-loading" aria-busy="true"><h1>Storefront content</h1><p>Loading your local draft…</p><div /><div /></div>}</OperationsShell>;
}
