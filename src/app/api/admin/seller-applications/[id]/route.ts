import { hasPermission } from "@/lib/permissions";
import { sellerReviewSchema } from "@/lib/seller-application";
import { auth } from "@/server/auth";
import { readSellerBody, sellerErrorResponse, sellerResponse } from "@/server/seller-api";
import { reviewSellerApplication } from "@/server/seller-applications";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return sellerResponse({ error: "Sign in to review seller applications." }, 401);
    if (!hasPermission(session.user.role, "vendors:review")) return sellerResponse({ error: "You do not have access to review seller applications." }, 403);
    const command = sellerReviewSchema.parse(await readSellerBody(request));
    const { id } = await context.params;
    return sellerResponse({ application: await reviewSellerApplication(session.user.id, id, command) });
  } catch (error) { return sellerErrorResponse(error); }
}
