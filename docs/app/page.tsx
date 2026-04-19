import Image from "next/image";
import Link from "next/link";
import { GlyphField } from "./_components/GlyphField";
import { Navbar } from "./_components/Navbar";
import { SparkleField } from "./_components/SparkleField";
import { StatsSection } from "./_components/StatsSection";

const OUTLINE = "var(--sushi-outline)";
const ON_ACCENT = "#1c1b2e";

function hardShadow(x = 5, y = 5) {
  return `${x}px ${y}px 0 ${OUTLINE}`;
}

const FEATURES = [
  {
    title: "Case Management",
    tag: "moderation",
    body: "Every mod action — commands, bans, timeouts, even built-in Discord tools — tracked with searchable cases, reasons, and evidence.",
    cmd: "/case view 482",
  },
  {
    title: "Message & Member Logs",
    tag: "logging",
    body: "Edits, deletes, first reactors, role changes, nickname history. Full accountability, queryable after the fact.",
    cmd: "/logs user @ren",
  },
  {
    title: "XP & Levels",
    tag: "engagement",
    body: "Activity-based progression with automatic role rewards. Leaderboards, per-channel multipliers, cooldowns.",
    cmd: "/rank",
  },
  {
    title: "Role Menus",
    tag: "community",
    body: "Self-serve buttons or dropdowns for colors, pronouns, notifications. Members customize themselves, you stop copy-pasting.",
    cmd: "/rolemenu create",
  },
  {
    title: "Custom Commands",
    tag: "tags",
    body: "Tags for FAQs, rules, reminders. Rich embeds, variables, permission gates. Your community wiki as Discord commands.",
    cmd: "/tag rules",
  },
  {
    title: "Giveaways",
    tag: "events",
    body: "Gate entries by role, level, or booster status. Auto-reroll, scheduled drops, and notifier pings built in.",
    cmd: "/giveaway start",
  },
  {
    title: "Emoji & Sticker Stats",
    tag: "insights",
    body: "See which emoji are loved, which are dust. Per-user, per-channel, per-time-range breakdowns.",
    cmd: "/stats emoji",
  },
  {
    title: "Utilities & Social",
    tag: "extras",
    body: "Reminders, keyword notifications, reputation, fishies. The friendly bits that make a server feel like home.",
    cmd: "/remind 2h",
  },
];

const ACCENT_CYCLE = [
  "var(--sushi-pink)",
  "var(--sushi-lilac)",
  "var(--sushi-blue)",
  "var(--sushi-gold)",
];

export default function HomePage() {
  return (
    <main
      style={{
        position: "relative",
        background: "var(--sushi-bg)",
        color: "var(--sushi-ink)",
        fontFamily: "var(--font-body), system-ui, sans-serif",
        overflowX: "hidden",
      }}
    >
      <Navbar />
      <GlyphField />
      <SparkleField />

      {/* ── HERO ── */}
      <section
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "60px 24px 80px",
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          gap: 56,
          alignItems: "center",
          position: "relative",
          zIndex: 2,
        }}
      >
        {/* Left */}
        <div>
          {/* Status badge */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              background: "var(--sushi-card)",
              border: `3px solid ${OUTLINE}`,
              borderRadius: 999,
              padding: "6px 14px 6px 8px",
              boxShadow: hardShadow(3, 3),
              marginBottom: 24,
              fontSize: 13,
              fontWeight: 700,
              color: "var(--sushi-ink)",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                background: "#6dd58c",
                border: `2px solid ${OUTLINE}`,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            Moderating since 2019
            <span
              style={{
                fontFamily: "'Zen Maru Gothic', sans-serif",
                fontWeight: 700,
                color: "var(--sushi-ink2)",
                fontSize: 12,
                letterSpacing: "0.04em",
              }}
            >
              ・モデレーター
            </span>
          </div>

          {/* H1 */}
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(44px, 5.5vw, 64px)",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              margin: "0 0 24px",
              color: "var(--sushi-ink)",
            }}
          >
            Community management
            <br />
            {"that's actually"}
            <br />
            <span style={{ position: "relative", display: "inline-block", color: ON_ACCENT }}>
              <span
                style={{
                  position: "absolute",
                  inset: "-4px -8px",
                  background: "var(--sushi-pink)",
                  borderRadius: 12,
                  border: `3px solid ${OUTLINE}`,
                  transform: "rotate(-1.5deg)",
                  zIndex: -1,
                }}
              />
              kinda cute.
            </span>
          </h1>

          <p
            style={{
              fontSize: 18,
              lineHeight: 1.55,
              color: "var(--sushi-ink2)",
              maxWidth: 480,
              margin: "0 0 36px",
            }}
          >
            Everything your server needs. Without the usual jank.
          </p>

          {/* CTAs */}
          <div
            style={{
              display: "flex",
              gap: 14,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <a
              href="#"
              style={{
                background: "var(--sushi-lilac)",
                color: ON_ACCENT,
                border: `3px solid ${OUTLINE}`,
                padding: "14px 28px",
                borderRadius: 16,
                fontFamily: "var(--font-display)",
                fontSize: 16,
                cursor: "pointer",
                boxShadow: hardShadow(5, 5),
                display: "flex",
                alignItems: "center",
                gap: 10,
                textDecoration: "none",
              }}
            >
              Add to your server
              <span>→</span>
            </a>
            <Link
              href="/docs"
              style={{
                background: "var(--sushi-card)",
                color: "var(--sushi-ink)",
                border: `3px solid ${OUTLINE}`,
                padding: "14px 24px",
                borderRadius: 16,
                fontFamily: "var(--font-display)",
                fontSize: 16,
                cursor: "pointer",
                boxShadow: hardShadow(5, 5),
                textDecoration: "none",
              }}
            >
              Read the docs
            </Link>
          </div>

          {/* Trust row */}
          <div
            style={{
              marginTop: 36,
              display: "flex",
              alignItems: "center",
              gap: 16,
              fontSize: 13,
              color: "var(--sushi-ink2)",
              fontWeight: 600,
            }}
          >
            <div style={{ display: "flex" }}>
              {ACCENT_CYCLE.map((c, i) => (
                <div
                  key={i}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 999,
                    background: c,
                    border: `3px solid ${OUTLINE}`,
                    marginLeft: i === 0 ? 0 : -10,
                  }}
                />
              ))}
            </div>
            Trusted by thousands of servers
          </div>
        </div>

        {/* Right — mascot card */}
        <div
          style={{ position: "relative", display: "flex", justifyContent: "center" }}
        >
          {/* Floating badges */}
          <div
            style={{
              position: "absolute",
              top: "4%",
              left: "-4%",
              background: "var(--sushi-card)",
              border: `3px solid ${OUTLINE}`,
              borderRadius: 14,
              padding: "10px 14px",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--sushi-ink)",
              boxShadow: hardShadow(4, 4),
              transform: "rotate(-6deg)",
              zIndex: 3,
            }}
          >
            /ban @troll 7d
          </div>
          <div
            style={{
              position: "absolute",
              bottom: "8%",
              right: "-2%",
              background: "var(--sushi-pink)",
              border: `3px solid ${OUTLINE}`,
              borderRadius: 14,
              padding: "10px 14px",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              fontWeight: 600,
              color: ON_ACCENT,
              boxShadow: hardShadow(4, 4),
              transform: "rotate(5deg)",
              zIndex: 3,
            }}
          >
            case #482 ✓
          </div>
          <div
            style={{
              position: "absolute",
              top: "38%",
              right: "-6%",
              background: "var(--sushi-blue)",
              border: `3px solid ${OUTLINE}`,
              borderRadius: 14,
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 700,
              color: ON_ACCENT,
              boxShadow: hardShadow(3, 3),
              transform: "rotate(8deg)",
              zIndex: 3,
            }}
          >
            +150 XP
          </div>

          {/* Main mascot sticker */}
          <div
            style={{
              width: 420,
              height: 420,
              background: "var(--sushi-lilac)",
              border: `4px solid ${OUTLINE}`,
              borderRadius: 32,
              boxShadow: hardShadow(10, 10),
              display: "grid",
              placeItems: "center",
              position: "relative",
              transform: "rotate(-2deg)",
            }}
          >
            <Image
              src="/sushii.svg"
              alt="sushii mascot"
              width={360}
              height={360}
              style={{ objectFit: "contain" }}
              priority
            />
            {/* Tape strip */}
            <div
              style={{
                position: "absolute",
                top: -14,
                left: "50%",
                width: 80,
                height: 24,
                background: "rgba(255,255,255,0.6)",
                border: `2px solid ${OUTLINE}`,
                transform: "translateX(-50%) rotate(-4deg)",
                borderRadius: 4,
              }}
            />
            <span
              style={{
                position: "absolute",
                bottom: 18,
                right: 24,
                fontFamily: "'Zen Maru Gothic', sans-serif",
                fontWeight: 700,
                color: ON_ACCENT,
                fontSize: 16,
                opacity: 0.85,
                letterSpacing: "0.04em",
              }}
            >
              すし・bot
            </span>
          </div>
        </div>
      </section>

      {/* ── STATS STRIP ── */}
      <section
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "0 24px 100px",
          position: "relative",
          zIndex: 2,
        }}
      >
        <StatsSection />
      </section>

      {/* ── FEATURES GRID ── */}
      <section
        id="features"
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "0 24px 120px",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--sushi-ink2)",
              marginBottom: 8,
            }}
          >
            きのう · FEATURES
          </div>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(32px, 4vw, 48px)",
              margin: 0,
              color: "var(--sushi-ink)",
            }}
          >
            Everything your mods wish they had
          </h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 20,
          }}
        >
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              style={{
                background: "var(--sushi-card)",
                border: `3px solid ${OUTLINE}`,
                borderRadius: 20,
                padding: 22,
                boxShadow: hardShadow(5, 5),
                position: "relative",
              }}
            >
              {/* Icon box */}
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  background: ACCENT_CYCLE[i % ACCENT_CYCLE.length],
                  border: `3px solid ${OUTLINE}`,
                  marginBottom: 16,
                  boxShadow: hardShadow(2, 2),
                  display: "grid",
                  placeItems: "center",
                  fontFamily: "var(--font-display)",
                  color: ON_ACCENT,
                  fontSize: 20,
                }}
              >
                {f.title.charAt(0)}
              </div>

              {/* Tag */}
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--sushi-ink2)",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {f.tag}
              </div>

              <h3
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 18,
                  margin: "0 0 10px",
                  color: "var(--sushi-ink)",
                  lineHeight: 1.2,
                }}
              >
                {f.title}
              </h3>
              <p
                style={{
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: "var(--sushi-ink2)",
                  margin: 0,
                }}
              >
                {f.body}
              </p>

              {/* Command chip */}
              <div
                style={{
                  marginTop: 14,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "var(--sushi-card2)",
                  border: `2px solid ${OUTLINE}`,
                  borderRadius: 10,
                  padding: "6px 10px",
                  color: "var(--sushi-ink)",
                }}
              >
                {f.cmd}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── COMMAND SHOWCASE ── */}
      <section
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "0 24px 120px",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "0.9fr 1.1fr",
            gap: 48,
            alignItems: "center",
          }}
        >
          {/* Left */}
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--sushi-ink2)",
                marginBottom: 8,
              }}
            >
              コマンド
            </div>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(28px, 3.5vw, 44px)",
                margin: "0 0 20px",
                color: "var(--sushi-ink)",
                lineHeight: 1.05,
              }}
            >
              See it in action.
            </h2>
            <p
              style={{
                fontSize: 16,
                lineHeight: 1.6,
                color: "var(--sushi-ink2)",
                marginBottom: 24,
              }}
            >
              Every mod action is a tracked case. Search, edit reasons, attach
              evidence, appeal through the bot. Your team stops losing the
              thread.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(
                [
                  ["/case view 482", "Pull up a case with full context"],
                  ["/warn @user spam", "Log a warning, auto-case it"],
                  ["/history @user", "Full mod history across channels"],
                  ["/timeout @user 1h", "Native timeout, tracked for you"],
                ] as [string, string][]
              ).map(([cmd, desc]) => (
                <div
                  key={cmd}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "10px 14px",
                    borderRadius: 12,
                    background: "var(--sushi-card)",
                    border: `2px solid ${OUTLINE}`,
                  }}
                >
                  <code
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--sushi-ink)",
                      minWidth: 160,
                    }}
                  >
                    {cmd}
                  </code>
                  <span
                    style={{ fontSize: 13, color: "var(--sushi-ink2)" }}
                  >
                    {desc}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right — faux Discord card */}
          <div
            style={{
              background: "var(--sushi-card)",
              border: `3px solid ${OUTLINE}`,
              borderRadius: 22,
              boxShadow: hardShadow(8, 8),
              overflow: "hidden",
              transform: "rotate(1deg)",
            }}
          >
            {/* Discord message header */}
            <div
              style={{
                background: "var(--sushi-lilac)",
                padding: "14px 18px",
                borderBottom: `3px solid ${OUTLINE}`,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  background: "var(--sushi-card)",
                  border: `2px solid ${OUTLINE}`,
                  display: "grid",
                  placeItems: "center",
                  overflow: "hidden",
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
                  fontSize: 14,
                  color: ON_ACCENT,
                }}
              >
                sushii
              </span>
              <div
                style={{
                  marginLeft: "auto",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  background: OUTLINE,
                  color: "#ffffff",
                  padding: "3px 8px",
                  borderRadius: 6,
                }}
              >
                APP
              </div>
            </div>

            {/* Case body */}
            <div style={{ padding: 20 }}>
              <div
                style={{
                  borderLeft: `4px solid var(--sushi-pink)`,
                  paddingLeft: 14,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 16,
                    color: "var(--sushi-ink)",
                  }}
                >
                  Case #482 · Timeout
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--sushi-ink2)",
                    marginTop: 4,
                  }}
                >
                  <strong style={{ color: "var(--sushi-ink)" }}>user</strong>{" "}
                  @ren ·{" "}
                  <strong style={{ color: "var(--sushi-ink)" }}>mod</strong>{" "}
                  @kai ·{" "}
                  <strong style={{ color: "var(--sushi-ink)" }}>
                    duration
                  </strong>{" "}
                  1h
                </div>
                <div
                  style={{
                    marginTop: 12,
                    padding: "10px 12px",
                    background: "var(--sushi-card2)",
                    borderRadius: 10,
                    fontSize: 13,
                    color: "var(--sushi-ink)",
                    lineHeight: 1.5,
                  }}
                >
                  <strong>reason</strong> — spamming #general with link
                  shorteners. second offense this week. escalation if repeated.
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  {["edit reason", "appeal", "attach log"].map((b) => (
                    <button
                      key={b}
                      style={{
                        background: "var(--sushi-card)",
                        border: `2px solid ${OUTLINE}`,
                        borderRadius: 8,
                        padding: "6px 12px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--sushi-ink)",
                        fontFamily: "var(--font-body)",
                        cursor: "pointer",
                      }}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── GETTING STARTED CTA ── */}
      <section
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "0 24px 100px",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div
          style={{
            background: "var(--sushi-lilac)",
            border: `3px solid ${OUTLINE}`,
            borderRadius: 28,
            padding: "48px",
            boxShadow: hardShadow(10, 10),
            display: "grid",
            gridTemplateColumns: "1fr auto",
            alignItems: "center",
            gap: 40,
            position: "relative",
            overflow: "hidden",
            color: ON_ACCENT,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: ON_ACCENT,
                opacity: 0.7,
                marginBottom: 8,
              }}
            >
              はじめる
            </div>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(28px, 3.5vw, 44px)",
                margin: "0 0 12px",
                color: ON_ACCENT,
                lineHeight: 1.05,
              }}
            >
              Install in 30 seconds.
            </h2>
            <p
              style={{
                fontSize: 16,
                color: ON_ACCENT,
                opacity: 0.75,
                marginBottom: 24,
                maxWidth: 460,
              }}
            >
              One-click OAuth, sensible defaults, first case logged before your
              coffee cools.
            </p>
            <a
              href="#"
              style={{
                display: "inline-block",
                background: "var(--sushi-ink)",
                color: "var(--sushi-card)",
                border: `3px solid ${OUTLINE}`,
                padding: "14px 28px",
                borderRadius: 16,
                fontFamily: "var(--font-display)",
                fontSize: 16,
                cursor: "pointer",
                boxShadow: hardShadow(5, 5),
                textDecoration: "none",
              }}
            >
              Add sushii to Discord →
            </a>
          </div>
          <div style={{ width: 180, height: 180, transform: "rotate(8deg)" }}>
            <Image
              src="/sushii.svg"
              alt=""
              width={180}
              height={180}
              style={{ objectFit: "contain" }}
            />
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
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
          <span
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--sushi-ink)",
            }}
          >
            sushii
          </span>
          <span>© 2026</span>
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {(
            [
              ["Docs", "/docs"],
              ["GitHub", "https://github.com/drklee3/sushii-2"],
              ["Discord", "#"],
["Privacy", "/privacy"],
            ] as [string, string][]
          ).map(([label, href]) => (
            <a
              key={label}
              href={href}
              style={{
                color: "var(--sushi-ink2)",
                textDecoration: "none",
              }}
            >
              {label}
            </a>
          ))}
        </div>
      </footer>
    </main>
  );
}
