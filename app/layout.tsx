import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const description =
  "A private collection manager for watch collectors to catalogue watches, track values, record notes, and build a visual archive of their collection.";

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: {
    default: "Wristfolio",
    template: "%s · Wristfolio",
  },
  description,
  applicationName: "Wristfolio",
  appleWebApp: {
    title: "Wristfolio",
  },
  openGraph: {
    title: "Wristfolio",
    description,
    siteName: "Wristfolio",
    type: "website",
    locale: "en",
  },
  twitter: {
    card: "summary",
    title: "Wristfolio",
    description,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#07070a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
