import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "./auth";
import { hasPermission, type Permission } from "../lib/permissions";
import { safeReturnTo } from "../lib/auth-navigation";

// Session checks compare expiry with the current time, so they run at request time only.
export const currentSession = cache(async () => {
  await connection();
  return auth.api.getSession({ headers: await headers() });
});

export async function requireSession(destination = "/account") {
  const session = await currentSession();
  if (!session) redirect(`/sign-in?returnTo=${encodeURIComponent(safeReturnTo(destination))}`);
  return session;
}

export async function requirePermission(permission: Permission, destination: string) {
  const session = await requireSession(destination);
  if (!hasPermission(session.user.role, permission)) redirect("/access-denied");
  return session;
}
