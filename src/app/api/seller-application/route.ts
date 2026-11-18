import { sellerMutationSchema } from "@/lib/seller-application";
import { auth } from "@/server/auth";
import { readSellerBody, sellerErrorResponse, sellerResponse } from "@/server/seller-api";
import { getOwnSellerApplication, saveSellerApplication } from "@/server/seller-applications";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return sellerResponse({ error: "Sign in to view your seller application." }, 401);
    return sellerResponse({ application: await getOwnSellerApplication(session.user.id) });
  } catch (error) { return sellerErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return sellerResponse({ error: "Sign in to apply to sell." }, 401);
    const command = sellerMutationSchema.parse(await readSellerBody(request));
    return sellerResponse({ application: await saveSellerApplication(session.user.id, command) });
  } catch (error) { return sellerErrorResponse(error); }
}
