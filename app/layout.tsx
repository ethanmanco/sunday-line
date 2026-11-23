import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Barlow, Barlow_Condensed } from "next/font/google";
import AccountLink from "@/components/AccountLink";
import AuthProvider from "@/components/AuthProvider";
import NotificationsLink from "@/components/NotificationsLink";
import MessagesLink from "@/components/MessagesLink";
import PeopleLink from "@/components/PeopleLink";
import PhotoViewer from "@/components/PhotoViewer";
import ServiceWorker from "@/components/ServiceWorker";
import { SITE_NAME, SITE_URL } from "@/lib/config";
import "./globals.css";

const body = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });
const display = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  openGraph: { siteName: SITE_NAME, type: "website" },
  twitter: { card: "summary_large_image" },
  title: { default: `${SITE_NAME}: great driving roads`, template: `%s | ${SITE_NAME}` },
  description:
    "Find twisty, fast, paved roads anywhere in the United States, rated against real race tracks at legal speeds. Save spots, plan drives with your group.",
  // Installable (11.43): Home Screen icon and full-screen on iPhone.
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
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
        <AuthProvider>
        <a href="#main" className="skip">Skip to content</a>
        <header className="topbar">
          <Link href="/" className="brand" aria-label={`${SITE_NAME} home`}>
            <span className="brand-mark" aria-hidden="true" />
            SUNDAY LINE
          </Link>
          <nav aria-label="Main">
            <Link href="/" className="nav-roads">Roads</Link>
            <Link href="/groups">Groups</Link>
            <PeopleLink />
            <Link href="/about" className="nav-about">About</Link>
            <NotificationsLink />
            <MessagesLink />
            <AccountLink />
          </nav>
        </header>
        <main id="main">{children}</main>
        <ServiceWorker />
        <PhotoViewer />
        </AuthProvider>
      </body>
    </html>
  );
}
