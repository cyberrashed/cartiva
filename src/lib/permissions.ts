export const roles = ["owner", "administrator", "manager", "staff", "vendor_owner", "vendor_staff", "customer"] as const;
export type Role = (typeof roles)[number];

export const permissions = ["admin:view", "catalog:manage", "content:manage", "orders:manage", "checkout:manage", "vendor:view", "pos:use", "vendors:review"] as const;
export type Permission = (typeof permissions)[number];

export const rolePermissions: Readonly<Record<Role, readonly Permission[]>> = {
  owner: permissions,
  administrator: permissions,
  manager: ["admin:view", "catalog:manage", "content:manage", "orders:manage", "checkout:manage", "pos:use"],
  staff: ["pos:use"],
  vendor_owner: ["vendor:view"],
  vendor_staff: ["vendor:view"],
  customer: [],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && roles.some(role => role === value);
}

export function hasPermission(role: unknown, permission: unknown): boolean {
  return isRole(role) && rolePermissions[role].some(grant => grant === permission);
}

// IDs must come from server-verified membership and the requested resource,
// never the selectable vendor in the sample dashboard. Queries still need this scope.
export function canAccessVendor(role: unknown, actorVendorId: unknown, resourceVendorId: unknown): boolean {
  if (typeof resourceVendorId !== "string" || resourceVendorId.trim().length === 0) return false;
  if (role === "owner" || role === "administrator") return true;
  if (!hasPermission(role, "vendor:view")) return false;
  return typeof actorVendorId === "string" && actorVendorId.trim().length > 0 && actorVendorId === resourceVendorId;
}
