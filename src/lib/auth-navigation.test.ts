import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnTo } from "./auth-navigation.ts";

test("post-login navigation accepts only exact account and operations destinations", () => {
  for (const path of ["/account", "/admin", "/admin/orders", "/admin/products", "/admin/content", "/admin/seller-applications", "/become-vendor/apply", "/vendor", "/pos", "/account/orders/CV-2001", "/admin/orders/CV-2001"]) {
    assert.equal(safeReturnTo(path), path);
  }
});

test("order destinations accept only the fixed order-number format", () => {
  for (const value of ["/account/orders/", "/account/orders/2001", "/account/orders/cv-2001", "/account/orders/CV-2001/", "/account/orders/CV-2001?x=1",
    "/account/orders/CV-", "/account/orders/CV-1234567890123", "/vendor/orders/CV-2001", "/admin/orders/CV-2001/../../pos", "//admin/orders/CV-2001"]) {
    assert.equal(safeReturnTo(value), "/account");
  }
});

test("post-login navigation rejects external, encoded and ambiguous destinations", () => {
  for (const value of [
    "https://example.test/admin", "http://127.0.0.1:3000/admin", "//example.test/admin",
    "\\\\example.test\\admin", "/\\example.test/admin", "\\admin", "/admin\\products",
    "%2Fadmin", "/%61dmin", "/admin%2Fproducts", "%2F%2Fexample.test", "/admin%3Fnext=evil",
    "/admin?next=https://example.test", "/account?tab=profile", "/admin#content",
    "/admin/", "/admin/../pos", "/admin//products", "/Admin", " /admin", "/admin ", "/admin\n",
    "/", "/login", "/products", "javascript:alert(1)", "data:text/html,test", "",
    undefined, null, 0, true, ["/admin"], ["/account", "/admin"], { returnTo: "/admin" },
  ]) {
    assert.equal(safeReturnTo(value), "/account");
  }
});
