import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
});

const metadataBase = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://testinglives.com");

export const metadata: Metadata = {
  metadataBase,
  title: "Testing Lives",
  description: "Respectful HIV awareness and testing information for every community.",
  openGraph: {
    type: "website",
    title: "Testing Lives",
    description: "Respectful HIV awareness and testing information for every community.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Testing Lives",
    description: "Respectful HIV awareness and testing information for every community.",
  },
  appleWebApp: {
    capable: true,
    title: "Testing Lives",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#095ae7",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={roboto.variable}>
      <body>{children}</body>
    </html>
  );
}
