"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { Product } from "@/lib/catalog";
import { sanitizeCart, updateCart, type CartLine } from "@/lib/cart";

const key = "cartiva-preview-v1";
const empty = JSON.stringify({ lines: [], saved: [] });
let memory = empty;
let memoryOnly = false;
function snapshot() {
  if (memoryOnly) return memory;
  try { return localStorage.getItem(key) ?? memory; } catch { return memory; }
}
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(key, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(key, notify); };
}
type StoreState = { lines: CartLine[]; saved: string[] };
export type FreeDeliveryHint = { thresholdCents: number; zoneName: string } | null;
type Store = StoreState & {
  products: Product[];
  freeDelivery: FreeDeliveryHint;
  setQuantity: (product: Product, variantId: string, quantity: number) => void;
  toggleSaved: (id: string) => void;
  clearCart: () => void;
};
const Context = createContext<Store | null>(null);

/**
 * Holds the published catalog (from the database, via the store layout) and the
 * browser-local bag and saved items. Bag lines are re-checked against the current
 * catalog, so removed variants drop out and quantities respect current stock.
 */
export function StoreProvider({ catalog, freeDelivery, children }: { catalog: Product[]; freeDelivery: FreeDeliveryHint; children: React.ReactNode }) {
  const raw = useSyncExternalStore(subscribe, snapshot, () => empty);
  const state = useMemo<StoreState>(() => {
    try {
      const parsed = JSON.parse(raw);
      return {
        lines: sanitizeCart(parsed?.lines, catalog),
        saved: Array.isArray(parsed?.saved) ? [...new Set<string>(parsed.saved.filter((id: unknown) => catalog.some(p => p.id === id)))] : [],
      };
    } catch { return { lines: [], saved: [] }; }
  }, [raw, catalog]);
  function write(next: StoreState) {
    memory = JSON.stringify(next);
    try { localStorage.setItem(key, memory); memoryOnly = false; } catch { memoryOnly = true; }
    window.dispatchEvent(new Event(key));
  }
  const store: Store = {
    ...state,
    products: catalog,
    freeDelivery,
    setQuantity: (product, variantId, quantity) => write({ ...state, lines: updateCart(state.lines, product, variantId, quantity) }),
    toggleSaved: id => write({ ...state, saved: state.saved.includes(id) ? state.saved.filter(item => item !== id) : [...state.saved, id] }),
    clearCart: () => write({ ...state, lines: [] }),
  };
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useStore() {
  const store = useContext(Context);
  if (!store) throw new Error("StoreProvider is required");
  return store;
}

/** The published catalog shared by every storefront page. */
export function useCatalog() {
  return useStore().products;
}
