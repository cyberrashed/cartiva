import { productInputSchema } from "@/lib/catalog-admin";
import { listAdminProducts, saveCatalogProduct } from "@/server/catalog";
import { catalogErrorResponse, catalogResponse, readCatalogBody, requireCatalogManager } from "@/server/catalog-api";
import { invalidateCatalog } from "@/server/catalog-cache";

export async function GET(request: Request) {
  try {
    await requireCatalogManager(request);
    return catalogResponse({ products: await listAdminProducts() });
  } catch (error) { return catalogErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireCatalogManager(request);
    const input = productInputSchema.parse(await readCatalogBody(request));
    const product = await saveCatalogProduct(actor.id, undefined, input);
    invalidateCatalog();
    return catalogResponse({ product }, 201);
  } catch (error) { return catalogErrorResponse(error); }
}
