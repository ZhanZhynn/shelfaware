/**
 * Root layout: fonts, metadata (SEO), and providers (Query, Auth, Theme, Toaster).
 * Wraps all pages; force-dynamic so useSearchParams and server session work correctly.
 */
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KeyboardShortcutsProvider } from "@/components/providers/KeyboardShortcutsProvider";
import { Poppins } from "next/font/google";
import localFont from "next/font/local";
import React from "react";
import { AuthProvider } from "@/contexts";
import { QueryProvider } from "@/lib/react-query";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { SuppressApiErrorOverlay } from "@/components/shared/SuppressApiErrorOverlay";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-poppins",
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
});

/** Force dynamic rendering for all routes so useSearchParams etc. work without Suspense and pages render instantly. */
export const dynamic = "force-dynamic";

export const metadata = {
  title: {
    default: "ShelfAware — Warehouse & Stock Inventory Management System",
    template: "%s | ShelfAware — Warehouse & Stock Inventory Management System",
  },
  description:
    "ShelfAware is a full-stack warehouse and stock inventory management system built with Next.js. Manage products, categories, suppliers, orders, invoices, and warehouses. Role-based access for admin, client, and supplier. Analytics dashboard, QR codes, export, and secure JWT authentication. By Arnob Mahmud.",
  authors: [
    {
      name: "Arnob Mahmud",
      url: "https://www.arnobmahmud.com",
      email: "contact@arnobmahmud.com",
    },
  ],
  creator: "Arnob Mahmud",
  publisher: "Arnob Mahmud",
  applicationName: "ShelfAware",
  keywords: [
    "stock inventory",
    "inventory management",
    "warehouse management",
    "stock management system",
    "Next.js",
    "React",
    "Prisma",
    "product catalog",
    "orders",
    "invoices",
    "suppliers",
    "categories",
    "JWT authentication",
    "responsive web app",
    "business dashboard",
    "Arnob Mahmud",
  ],
  icons: {
    icon: "/favicon.ico",
    apple: "/favicon.ico",
    other: [{ rel: "icon", url: "/favicon.ico" }],
  },
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "https://console.shelfaware.my",
  ),
  openGraph: {
    type: "website",
    locale: "en_US",
    title: "ShelfAware — Warehouse & Stock Inventory Management System",
    description:
      "Efficiently manage products, orders, invoices, and warehouses with ShelfAware. Secure, responsive, role-based inventory system. By Arnob Mahmud.",
    url: "https://console.shelfaware.my",
    siteName: "ShelfAware",
    images: [
      {
        url: "/favicon.ico",
        width: 32,
        height: 32,
        alt: "ShelfAware — Stock Inventory Management",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ShelfAware — Warehouse & Stock Inventory Management System",
    description:
      "Efficiently manage products, orders, invoices, and warehouses. Secure, responsive inventory system. By Arnob Mahmud.",
    images: ["/favicon.ico"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

/** Optional: set NEXT_PUBLIC_DISABLE_BROWSER_TRANSLATE=true on Vercel prod only (blocks Chrome Translate). */
const disableBrowserTranslate =
  process.env.NEXT_PUBLIC_DISABLE_BROWSER_TRANSLATE === "true";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      {...(disableBrowserTranslate ? { translate: "no" as const } : {})}
      suppressHydrationWarning
      style={{ overscrollBehavior: "none" }}
      data-scroll-behavior="smooth"
    >
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${poppins.variable} antialiased`}
        suppressHydrationWarning
        style={{ overscrollBehavior: "none" }}
      >
        <ErrorBoundary>
          <QueryProvider>
            <AuthProvider>
              <SuppressApiErrorOverlay />
              <ThemeProvider
                attribute="class"
                defaultTheme="system"
                enableSystem
                disableTransitionOnChange
              >
                <TooltipProvider delayDuration={200}>
                  <KeyboardShortcutsProvider>
                    {children}
                  </KeyboardShortcutsProvider>
                </TooltipProvider>
              </ThemeProvider>
              <Toaster />
              <Analytics />
              <SpeedInsights />
            </AuthProvider>
          </QueryProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
