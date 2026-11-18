import { hasPermission } from "@/lib/permissions";
import { auth } from "@/server/auth";
import { sellerErrorResponse, sellerResponse } from "@/server/seller-api";
import { listSellerApplications } from "@/server/seller-applications";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return sellerResponse({ error: "Sign in to review seller applications." }, 401);
    if (!hasPermission(session.user.role, "vendors:review")) return sellerResponse({ error: "You do not have access to review seller applications." }, 403);
    return sellerResponse({ applications: await listSellerApplications() });
  } catch (error) { return sellerErrorResponse(error); }
}
