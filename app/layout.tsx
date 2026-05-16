import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const description =
  "HoroLair is a private collection manager for watch collectors to catalogue watches, track values, record notes, and build a visual archive of their collection.";

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: {
    default: "HoroLair",
    template: "%s · HoroLair",
  },
  description,
  applicationName: "HoroLair",
  appleWebApp: {
    title: "HoroLair",
  },
  openGraph: {
    title: "HoroLair",
    description,
    siteName: "HoroLair",
    type: "website",
    locale: "en",
  },
  twitter: {
    card: "summary",
    title: "HoroLair",
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
