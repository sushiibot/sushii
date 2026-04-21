import { RootProvider } from "fumadocs-ui/provider";
import {
  Mochiy_Pop_One,
  Plus_Jakarta_Sans,
  JetBrains_Mono,
} from "next/font/google";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "fumadocs-ui/style.css";
import "./global.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://sushii.bot"),
  title: {
    default: "sushii",
    template: "%s | sushii",
  },
  description: "Complete Discord community management bot.",
  openGraph: {
    siteName: "sushii",
    type: "website",
    images: [{ url: "/sushii.png", width: 512, height: 512, alt: "sushii" }],
  },
  twitter: {
    card: "summary",
  },
};

export const viewport: Viewport = {
  themeColor: "#fbc4c9",
};

const fontDisplay = Mochiy_Pop_One({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const fontBody = Plus_Jakarta_Sans({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const fontMono = JetBrains_Mono({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
    >
      <body className="flex min-h-screen flex-col font-body">
        <RootProvider search={{ options: { type: "static" } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
