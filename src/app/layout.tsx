import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const jost = localFont({ src: "./fonts/Jost.ttf", variable: "--font-body", display: "swap" });
const bodoni = localFont({ src: "./fonts/BodoniModa.ttf", variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Cartiva — Good things. Every day.", template: "%s | Cartiva" },
  description: "Considered finds for your home, your desk, and everywhere in between. Explore the Cartiva sample collection.",
  // Absolute URLs for link previews when the portfolio link is shared.
  metadataBase: new URL(process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000"),
  openGraph: {
    type: "website",
    siteName: "Cartiva",
    title: "Cartiva — a full-stack marketplace demo",
    description: "Next.js storefront with real orders, stock holds, Stripe sandbox payments, discount codes and an operations workspace.",
    images: [{ url: "/images/editorial-room.jpg", width: 2200, height: 1399, alt: "A quiet, sunlit contemporary living room." }],
  },
  // A demo store with sample products: keep it out of search results.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // Smooth scrolling for in-page links only; Next turns it off while changing pages.
      data-scroll-behavior="smooth"
      className={`${jost.variable} ${bodoni.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
