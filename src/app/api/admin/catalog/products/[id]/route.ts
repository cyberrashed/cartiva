import { productInputSchema } from "@/lib/catalog-admin";
import { saveCatalogProduct } from "@/server/catalog";
import { catalogErrorResponse, catalogResponse, readCatalogBody, requireCatalogManager } from "@/server/catalog-api";
import { invalidateCatalog } from "@/server/catalog-cache";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireCatalogManager(request);
    const input = productInputSchema.parse(await readCatalogBody(request));
    const { id } = await context.params;
    const product = await saveCatalogProduct(actor.id, id, input);
    invalidateCatalog();
    return catalogResponse({ product });
  } catch (error) { return catalogErrorResponse(error); }
}
