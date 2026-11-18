import { auth } from "@/server/auth";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const headers = { "Cache-Control": "private, no-store" };
  if (!session) return Response.json({ error: "Sign in to view your account." }, { status: 401, headers });
  const { id, name, email, role } = session.user;
  // Identity comes only from the session. Query parameters never select another user.
  return Response.json({ id, name, email, role }, { headers });
}
