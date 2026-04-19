import Image from "next/image";
import Link from "next/link";

export function Navbar() {
  return (
    <nav
      style={{ color: "var(--sushi-ink)" }}
      className="relative z-10 w-full"
    >
      <div
        className="mx-auto flex max-w-[1120px] items-center justify-between px-6 py-5"
      >
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 no-underline">
          <div
            style={{
              background: "var(--sushi-lilac)",
              border: "3px solid var(--sushi-outline)",
              boxShadow: "3px 3px 0 var(--sushi-outline)",
              width: 44,
              height: 44,
              borderRadius: 14,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <Image
              src="/sushii.png"
              alt="sushii"
              width={32}
              height={32}
              style={{ objectFit: "contain" }}
            />
          </div>
          <span
            className="font-display text-[22px] leading-none"
            style={{ color: "var(--sushi-ink)", letterSpacing: "-0.01em" }}
          >
            sushii
          </span>
        </Link>

        {/* Nav links + CTA */}
        <div className="flex items-center gap-7">
          <div className="hidden items-center gap-7 text-sm font-semibold sm:flex">
            <Link
              href="/#features"
              className="no-underline transition-opacity hover:opacity-70"
              style={{ color: "var(--sushi-ink)" }}
            >
              Features
            </Link>
            <Link
              href="/docs"
              className="no-underline transition-opacity hover:opacity-70"
              style={{ color: "var(--sushi-ink)" }}
            >
              Docs
            </Link>
            <a
              href="https://status.sushii.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline transition-opacity hover:opacity-70"
              style={{ color: "var(--sushi-ink)" }}
            >
              Status
            </a>
          </div>

          <a
            href="#"
            style={{
              background: "var(--sushi-ink)",
              color: "var(--sushi-card)",
              border: "3px solid var(--sushi-outline)",
              boxShadow: "3px 3px 0 var(--sushi-outline)",
              padding: "8px 18px",
              borderRadius: 999,
              fontFamily: "var(--font-display)",
              fontSize: 13,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Add to server
          </a>
        </div>
      </div>
    </nav>
  );
}
