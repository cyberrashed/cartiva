import Link from "next/link";

export const metadata = { title: "Access unavailable" };

export default function AccessDeniedPage() {
  return <main id="main" className="page-frame"><div className="empty-state"><h1>This area needs permission.</h1><p>Your account does not have access to this workspace. Your account and the store are still available.</p><Link className="button primary" href="/account">Back to my account</Link><Link className="text-link" href="/products">Browse the collection</Link></div></main>;
}
