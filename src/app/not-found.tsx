import Link from "next/link";
export default function NotFound() { return <main className="page-frame empty-state"><Link className="wordmark" href="/">cartiva</Link><h1>A little off course.</h1><p>We couldn’t find that page. There are still good things to discover.</p><Link className="button primary" href="/products">Explore the collection</Link></main>; }
