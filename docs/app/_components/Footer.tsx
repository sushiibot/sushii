import Image from "next/image";

const OUTLINE = "var(--sushi-outline)";

const LINKS: [string, string][] = [
  ["Docs", "/docs"],
  ["Discord", "#"],
  ["Privacy", "/privacy"],
  ["Terms", "/tos"],
];

export function Footer() {
  return (
    <footer
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: "32px 24px 60px",
        position: "relative",
        zIndex: 2,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderTop: `2px dashed ${OUTLINE}`,
        fontSize: 13,
        color: "var(--sushi-ink2)",
        flexWrap: "wrap",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Image src="/sushii.png" alt="" width={28} height={28} />
        <span style={{ fontFamily: "var(--font-display)", color: "var(--sushi-ink)" }}>
          sushii
        </span>
        <span>© 2026</span>
      </div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {LINKS.map(([label, href]) => (
          <a
            key={label}
            href={href}
            style={{ color: "var(--sushi-ink2)", textDecoration: "none" }}
          >
            {label}
          </a>
        ))}
      </div>
    </footer>
  );
}
