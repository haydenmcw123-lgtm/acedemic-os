import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import "./globals.css";

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SwingLab",
  description:
    "Slow-motion golf swing analysis. Pose, keyframes and tour-range comparison — entirely in your browser.",
  applicationName: "SwingLab",
};

export const viewport: Viewport = {
  themeColor: "#0B2E1F",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // The upload target is a large tap area; zoom would only fight it.
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${barlowCondensed.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="bg-fairway text-bone min-h-full">{children}</body>
    </html>
  );
}
