"use client";

import Link from "next/link";

export default function ErrorPage({ retry }: { retry: () => void }) {
  return <main id="main" className="page-frame"><div className="empty-state"><h1>We couldn’t load this page.</h1><p>Please try again in a moment.</p><button className="button primary" onClick={retry}>Try again</button><Link className="text-link" href="/">Back to the store</Link></div></main>;
}
