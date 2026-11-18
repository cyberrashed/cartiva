import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentSession } from "@/server/access";
import { safeReturnTo } from "@/lib/auth-navigation";
import "@/app/identity.css";

export const metadata = { title: "Sign in" };
export const instant = false;

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const returnTo = safeReturnTo((await searchParams).returnTo);
  if (await currentSession()) redirect(returnTo);
  return <AuthForm mode="sign-in" returnTo={returnTo} />;
}
