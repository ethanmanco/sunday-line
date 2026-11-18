import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { SITE_NAME } from "@/lib/config";
import "./globals.css";

const body = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });
const display = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display" });

export const metadata: Metadata = {
  title: { default: `${SITE_NAME}: great local driving roads`, template: `%s | ${SITE_NAME}` },
  description:
    "Find twisty, fast, paved roads near you, rated against real race tracks at legal speeds. Starting with northwest Louisiana, east Texas, and south Arkansas.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#101318",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>
        <a href="#main" className="skip">Skip to content</a>
        <header className="topbar">
          <Link href="/" className="brand" aria-label={`${SITE_NAME} home`}>
            <span className="brand-mark" aria-hidden="true" />
            SUNDAY LINE
          </Link>
          <nav aria-label="Main">
            <Link href="/">Roads</Link>
            <Link href="/about">About</Link>
          </nav>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
