import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Script from "next/script";
import { Barlow, Barlow_Condensed } from "next/font/google";
import AccountLink from "@/components/AccountLink";
import AuthProvider from "@/components/AuthProvider";
import BrandLink from "@/components/BrandLink";
import InstallButton from "@/components/InstallButton";
import NotificationsLink from "@/components/NotificationsLink";
import MessagesLink from "@/components/MessagesLink";
import PeopleLink from "@/components/PeopleLink";
import PhotoViewer from "@/components/PhotoViewer";
import ServiceWorker from "@/components/ServiceWorker";
import ViewCounter from "@/components/ViewCounter";
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
  // Installed iPhone app (11.45): full screen, top to bottom (black-translucent +
  // viewport-fit=cover). Leaving the status bar key out made iOS reserve the
  // status bar strip, so the app stopped short at the bottom. The iOS 26 blur
  // under the status bar is handled in CSS: the top bar is pinned (sticky) with
  // a solid background, which iOS fills the status bar with instead of blurring.
  // iOS reads this only when the app is added to the Home Screen.
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0d11",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        {/* The installed app's look (11.51), set before the page shows so the top bar never flashes. */}
        <Script id="app-mode" strategy="beforeInteractive">
          {"try{var s=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true,q=new URLSearchParams(location.search).get('app');if(q==='1')sessionStorage.setItem('sl-app','1');if(q==='0')sessionStorage.removeItem('sl-app');if(s||sessionStorage.getItem('sl-app')==='1')document.documentElement.classList.add('app-on')}catch(e){}"}
        </Script>
      </head>
      <body>
        {/* iPhone Home Screen app only (11.45): an invisible strip pinned to the top
            edge. iOS 26 blurs the top of installed web apps unless a fixed element
            with a background sits there; this one paints nothing (see globals.css). */}
        <div className="edge-strip" aria-hidden="true" />
        <AuthProvider>
        <a href="#main" className="skip">Skip to content</a>
        <header className="topbar">
          <BrandLink />
          <nav aria-label="Main">
            <Link href="/" className="nav-roads">Roads</Link>
            <Link href="/groups" className="groups-link" aria-label="Groups">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="17" cy="8.5" r="2.6" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M17 13.6c2.4.3 4 2.1 4 4.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="nav-label">Groups</span>
            </Link>
            <PeopleLink />
            <Link href="/about" className="nav-about">About</Link>
            <NotificationsLink />
            <MessagesLink />
            <InstallButton />
            <AccountLink />
          </nav>
        </header>
        <main id="main">{children}</main>
        <ServiceWorker />
        <ViewCounter />
        <PhotoViewer />
        </AuthProvider>
      </body>
    </html>
  );
}
