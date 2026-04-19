import { RootProvider } from "fumadocs-ui/provider";
import type { ReactNode } from "react";
import "fumadocs-ui/style.css";
import "./global.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
