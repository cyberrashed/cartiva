import "server-only";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { loadPublishedCatalog } from "./catalog";

const CATALOG_TAG = "catalog";

/**
 * The published catalog for the storefront and POS. Cached in the static shell and
 * expired on every catalog write, so stock and prices follow the database without
 * a request-time query per page. Building the app therefore needs the database.
 */
export async function getStorefrontCatalog() {
  "use cache";
  cacheLife("max");
  cacheTag(CATALOG_TAG);
  return loadPublishedCatalog();
}

/**
 * Expires the cached catalog immediately after a successful write (route handlers).
 * Outside the Next.js server (integration tests call handlers directly) there is no
 * cache to expire.
 */
export function invalidateCatalog() {
  if (!process.env.NEXT_RUNTIME) return;
  revalidateTag(CATALOG_TAG, { expire: 0 });
}
