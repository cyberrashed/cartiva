import Link from "next/link";
import "@/app/seller-onboarding.css";

export const metadata = { title: "Sell with Cartiva" };

const applicationReturn = encodeURIComponent("/become-vendor/apply");

export default function BecomeVendorPage() {
  return (
    <main id="main" className="seller-landing page-frame">
      <Link className="seller-back" href="/products">
        ← Back to the collection
      </Link>
      <div className="seller-landing-grid">
        <section
          className="seller-landing-intro"
          aria-labelledby="seller-landing-title"
        >
          <h1 id="seller-landing-title">
            A place for
            <br />
            your store.
          </h1>
          <p>
            Tell us what you make, find, or curate. Start a seller application
            for Cartiva’s home, tech, and everyday carry collection.
          </p>
          <Link href="/become-vendor/apply" className="button primary">
            Start or continue an application <span aria-hidden="true">↗</span>
          </Link>
          <p className="seller-sign-in">
            New to Cartiva?{" "}
            <Link href={`/sign-up?returnTo=${applicationReturn}`}>
              Create an account to apply
            </Link>
            .<br />
            Already have an account?{" "}
            <Link href={`/sign-in?returnTo=${applicationReturn}`}>Sign in</Link>
            .
          </p>
        </section>
        <section
          className="seller-landing-details"
          aria-labelledby="seller-process-title"
        >
          <h2 id="seller-process-title">Your store, in a few details.</h2>
          <dl>
            <div>
              <dt>Introduce your store</dt>
              <dd>
                Your store name, category, and a description of the products you
                plan to offer.
              </dd>
            </div>
            <div>
              <dt>Add your contact details</dt>
              <dd>
                A contact name and US location. Your account email stays
                connected to your application.
              </dd>
            </div>
            <div>
              <dt>Save, review, and submit</dt>
              <dd>
                Keep an unfinished draft and return when you’re ready. Follow
                its review status from your account.
              </dd>
            </div>
          </dl>
        </section>
      </div>
      <div className="seller-customer-link">
        <p>Here for your next good find?</p>
        <Link href="/sign-up?returnTo=%2Faccount">
          Create a customer account <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </main>
  );
}
