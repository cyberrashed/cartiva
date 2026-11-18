import assert from "node:assert/strict";
import test from "node:test";
import { canAccessVendor, hasPermission, isRole, permissions, rolePermissions, roles } from "./permissions.ts";

test("owner and administrator can use every current operations permission", () => {
  for (const role of ["owner", "administrator"]) {
    for (const permission of permissions) assert.equal(hasPermission(role, permission), true);
  }
});

test("manager, staff, vendor and customer grants stay within their intended jobs", () => {
  const expected: Record<string, readonly string[]> = {
    manager: ["admin:view", "catalog:manage", "content:manage", "orders:manage", "checkout:manage", "pos:use"],
    staff: ["pos:use"],
    vendor_owner: ["vendor:view"],
    vendor_staff: ["vendor:view"],
    customer: [],
  };
  for (const [role, grants] of Object.entries(expected)) {
    for (const permission of permissions) assert.equal(hasPermission(role, permission), grants.includes(permission), `${role}: ${permission}`);
  }
  assert.deepEqual(Object.keys(rolePermissions), [...roles]);
});

test("unknown roles, unsafe object keys and unrecognized permissions are denied", () => {
  for (const role of [undefined, null, "", "guest", "admin", "OWNER", " owner", "owner ", "owner,administrator", "__proto__", "constructor", "toString", {}, ["owner"], 1]) {
    assert.equal(isRole(role), false);
    for (const permission of permissions) assert.equal(hasPermission(role, permission), false);
  }
  for (const permission of [undefined, null, "", "*", "admin:*", "roles:manage", "__proto__", "constructor", "toString", {}, ["admin:view"]]) {
    for (const role of roles) assert.equal(hasPermission(role, permission), false);
  }
  for (const role of roles) assert.equal(isRole(role), true);
});

test("vendor members can read only their matching vendor scope", () => {
  for (const role of ["vendor_owner", "vendor_staff"]) {
    assert.equal(canAccessVendor(role, "vendor-a", "vendor-a"), true);
    assert.equal(canAccessVendor(role, "vendor-a", "vendor-b"), false);
    assert.equal(canAccessVendor(role, "vendor-a", "VENDOR-A"), false);
    assert.equal(canAccessVendor(role, "vendor-a", " vendor-a"), false);
  }
  for (const role of ["manager", "staff", "customer", "guest", "__proto__", "constructor", null]) {
    assert.equal(canAccessVendor(role, "vendor-a", "vendor-a"), false);
  }
});

test("missing or empty vendor scopes never authorize vendor membership", () => {
  const emptyIds = [undefined, null, "", " ", "\t\n", 0, {}, []];
  for (const emptyId of emptyIds) {
    for (const role of roles) assert.equal(canAccessVendor(role, "vendor-a", emptyId), false);
    for (const role of ["vendor_owner", "vendor_staff"]) {
      assert.equal(canAccessVendor(role, emptyId, "vendor-a"), false);
      assert.equal(canAccessVendor(role, emptyId, emptyId), false);
    }
  }
});

test("owner and administrator may cross vendor scopes for administration", () => {
  for (const role of ["owner", "administrator"]) {
    assert.equal(canAccessVendor(role, "vendor-a", "vendor-b"), true);
    assert.equal(canAccessVendor(role, null, "vendor-b"), true);
    assert.equal(canAccessVendor(role, undefined, "vendor-b"), true);
  }
});
