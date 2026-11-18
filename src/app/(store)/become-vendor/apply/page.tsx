import Link from "next/link";
import { SellerApplicationForm } from "@/components/seller-application-form";
import { requireSession } from "@/server/access";
import { getOwnSellerApplication } from "@/server/seller-applications";
import "@/app/seller-onboarding.css";

export const metadata = { title: "Seller application" };
export const instant = false;

export default async function SellerApplicationPage() {
  const { user } = await requireSession("/become-vendor/apply");
  const application = await getOwnSellerApplication(user.id);

  if (user.role !== "customer" && application?.status !== "approved") {
    return <main id="main" className="seller-page" data-ui>
      <Link className="seller-back" href="/account">← My account</Link>
      <h1>Seller application</h1>
      <div className="seller-access-note">
        <h2>Your account already has a workspace role.</h2>
        <p>Seller applications are available to customer accounts. Open your account to see the workspaces you can access.</p>
        <Link className="seller-primary" href="/account">Go to my account</Link>
      </div>
    </main>;
  }

  return <SellerApplicationForm initialApplication={application} name={user.name} email={user.email} />;
}
