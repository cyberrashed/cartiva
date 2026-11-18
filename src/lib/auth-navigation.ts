const destinations = new Set(["/account", "/admin", "/admin/orders", "/admin/shipping", "/admin/coupons", "/admin/products", "/admin/content", "/admin/seller-applications", "/become-vendor/apply", "/vendor", "/pos"]);
// Order pages are the only parameterized destinations; the number format is fixed.
const orderPage = /^\/(account|admin)\/orders\/CV-\d{1,12}$/;

export function safeReturnTo(value: unknown): string {
  return typeof value === "string" && (destinations.has(value) || orderPage.test(value)) ? value : "/account";
}
