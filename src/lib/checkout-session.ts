// Browser-tab state for one checkout: the idempotency key and the delivery details,
// so returning from the payment page resumes the same order instead of a new one.
// Both live in sessionStorage (this tab only) and are cleared once the order is paid.

const KEY = "cartiva-checkout-key";
const DELIVERY = "cartiva-checkout-delivery";
let memoryKey: string | null = null;

export type Delivery = { email: string; name: string; address: string; city: string; state: string; zip: string };
export const emptyDelivery: Delivery = { email: "", name: "", address: "", city: "", state: "", zip: "" };

export function checkoutKey(): string {
  try {
    const stored = sessionStorage.getItem(KEY);
    if (stored) return stored;
    const created = crypto.randomUUID();
    sessionStorage.setItem(KEY, created);
    return created;
  } catch {
    memoryKey ??= crypto.randomUUID();
    return memoryKey;
  }
}

export function storedDelivery(): Delivery {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DELIVERY) ?? "null");
    if (!parsed || typeof parsed !== "object") return emptyDelivery;
    return Object.fromEntries(Object.keys(emptyDelivery).map(field => [field, typeof parsed[field] === "string" ? parsed[field] : ""])) as Delivery;
  } catch { return emptyDelivery; }
}

export function storeDelivery(delivery: Delivery) {
  try { sessionStorage.setItem(DELIVERY, JSON.stringify(delivery)); } catch { /* the form still works without it */ }
}

const CHOICES = "cartiva-checkout-choices";
export type Choices = { shippingMethodId: string | null; couponCode: string | null };

/** The delivery option and code, so a return from the payment page resumes the same order. */
export function storedChoices(): Choices {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CHOICES) ?? "null");
    return {
      shippingMethodId: typeof parsed?.shippingMethodId === "string" ? parsed.shippingMethodId : null,
      couponCode: typeof parsed?.couponCode === "string" ? parsed.couponCode : null,
    };
  } catch { return { shippingMethodId: null, couponCode: null }; }
}

export function storeChoices(choices: Choices) {
  try { sessionStorage.setItem(CHOICES, JSON.stringify(choices)); } catch { /* the form still works without it */ }
}

/** Called after a paid order so the next checkout in this tab starts fresh. */
export function finishCheckoutSession() {
  memoryKey = null;
  try { for (const key of [KEY, DELIVERY, CHOICES]) sessionStorage.removeItem(key); } catch { /* nothing stored */ }
}
