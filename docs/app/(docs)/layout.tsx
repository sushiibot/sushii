import { DocsLayout } from "fumadocs-ui/layouts/docs";
import Image from "next/image";
import type { ReactNode } from "react";
import { source } from "@/lib/source";

const logoTitle = (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        background: "var(--sushi-lilac)",
        border: "2px solid var(--sushi-outline)",
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      <Image
        src="/sushii.png"
        alt=""
        width={20}
        height={20}
        style={{ objectFit: "contain" }}
      />
    </div>
    <span
      style={{
        fontFamily: "var(--font-display)",
        fontSize: 18,
        color: "var(--sushi-ink)",
        letterSpacing: "-0.01em",
      }}
    >
      sushii
    </span>
  </div>
);

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: logoTitle,
        children: (
          <a
            href="#"
            style={{
              marginLeft: "auto",
              background: "var(--sushi-ink)",
              color: "var(--sushi-card)",
              border: "2px solid var(--sushi-outline)",
              padding: "6px 14px",
              borderRadius: 999,
              fontFamily: "var(--font-display)",
              fontSize: 12,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Add to server
          </a>
        ),
      }}
    >
      {children}
    </DocsLayout>
  );
}
