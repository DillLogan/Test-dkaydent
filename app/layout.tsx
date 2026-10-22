import type { Metadata } from "next";
import { themeBootScript } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "DKaydent Wholesale",
  description: "Purchasing, inventory and sales for wholesale flowers and hard goods",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by the boot script before hydration
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  );
}
