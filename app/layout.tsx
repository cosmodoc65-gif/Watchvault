import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WatchVault",
  description: "A private vault for your watch collection.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

