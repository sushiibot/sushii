import Image from "next/image";
import Link from "next/link";
import { DISCORD_INVITE_URL } from "@/lib/config";
import { GlyphField } from "./_components/GlyphField";
import { Navbar } from "./_components/Navbar";
import { SparkleField } from "./_components/SparkleField";
import { StatsSection } from "./_components/StatsSection";

const OUTLINE = "var(--sushi-outline)";
const ON_ACCENT = "#1c1b2e";

function hardShadow(x = 5, y = 5) {
  return `${x}px ${y}px 0 ${OUTLINE}`;
}

// Priority order — matches /docs/user-reference/features section order.
// Update both when reprioritizing.
const FEATURES = [
  {
    title: "Scheduled Events",
    tag: "new",
    body: "Auto-post upcoming Discord events to a dedicated channel, kept up to date automatically. Your community always knows what's next — no manual announcements needed.",
    cmd: "/schedule-config",
  },
  {
    title: "Case Management",
    tag: "moderation",
    body: "Every mod action is tracked — even native Discord bans, kicks, and timeouts. No sushii commands required. Reasons are optional and can be set or updated any time after.",
    cmd: "/history @wawa",
  },
  {
    title: "Message & Member Logs",
    tag: "logging",
    body: "Edits, deletes, first reactors, role changes, nickname history. All automatically posted to your configured log channels.",
    cmd: "/settings",
  },
  {
    title: "XP & Levels",
    tag: "engagement",
    body: "Activity-based progression with automatic role rewards. Leaderboards, per-channel multipliers, cooldowns.",
    cmd: "/rank",
  },
  {
    title: "Custom Commands",
    tag: "tags",
    body: "Tags for FAQs, rules, reminders. Rich embeds, variables, permission gates. Your community wiki as Discord commands.",
    cmd: "/t rules",
  },
  {
    title: "Role Menus",
    tag: "community",
    body: "Self-serve buttons or dropdowns for colors, pronouns, notifications. Members customize themselves, you stop copy-pasting.",
    cmd: "/rolemenu create",
  },
  {
    title: "Giveaways",
    tag: "events",
    body: "Gate entries by role, level, or booster status. Auto-reroll, scheduled drops, and notifier pings built in.",
    cmd: "/giveaway create",
  },
  {
    title: "Emoji & Sticker Stats",
    tag: "insights",
    body: "See which emoji are loved, which are dust. Per-user, per-channel, per-time-range breakdowns.",
    cmd: "/emoji-stats",
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
        className="grid grid-cols-1 items-center gap-10 md:grid-cols-[1.1fr_0.9fr] md:gap-14"
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "60px 24px 80px",
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
              href={DISCORD_INVITE_URL}
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
          className="order-first md:order-none"
          style={{ position: "relative", display: "flex", justifyContent: "center" }}
        >
          {/* Main mascot sticker */}
          <div
            className="w-[min(280px,80vw)] h-[min(280px,80vw)] md:w-[420px] md:h-[420px]"
            style={{
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
            {/* Floating badges */}
            <div
              style={{
                position: "absolute",
                top: "4%",
                left: "-14%",
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
              /ban @wawa 7d
            </div>
            <div
              style={{
                position: "absolute",
                bottom: "8%",
                left: "-14%",
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
                right: "-14%",
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
            フィーチャー · FEATURES
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

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
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
        <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-[0.9fr_1.1fr] md:gap-12">
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
              sushii watches the audit log — so even native Discord bans,
              kicks, and timeouts are automatically tracked as cases. No sushii
              commands required. Reasons are optional: set them in the original
              action or fill them in later.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(
                [
                  ["Discord ban (native)", "Tracked automatically from audit log"],
                  ["/reason 482 second offense", "Set or update a reason any time"],
                  ["/history @wawa", "Full mod history in one view"],
                  ["/warn @wawa spam", "Or use sushii commands — your choice"],
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

          {/* Right — faux Discord mod log embed */}
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
            {/* Bot message row */}
            <div style={{ padding: "14px 18px 0" }}>
              {/* Bot name row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    background: "var(--sushi-lilac)",
                    border: `2px solid ${OUTLINE}`,
                    display: "grid",
                    placeItems: "center",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  <Image
                    src="/sushii.png"
                    alt=""
                    width={24}
                    height={24}
                    style={{ objectFit: "contain" }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 14,
                      color: "var(--sushi-ink)",
                    }}
                  >
                    sushii
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      background: "var(--sushi-blue)",
                      color: ON_ACCENT,
                      padding: "2px 6px",
                      borderRadius: 4,
                      border: `1.5px solid ${OUTLINE}`,
                    }}
                  >
                    APP
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--sushi-ink2)",
                    }}
                  >
                    Today at 3:42 PM
                  </span>
                </div>
              </div>

              {/* Embed */}
              <div
                style={{
                  marginLeft: 44,
                  marginBottom: 14,
                  borderLeft: `4px solid #f28fad`,
                  background: "var(--sushi-card2)",
                  borderRadius: "0 10px 10px 0",
                  padding: "10px 14px 12px",
                }}
              >
                {/* Embed author — executor */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      background: "var(--sushi-gold)",
                      border: `1.5px solid ${OUTLINE}`,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--sushi-ink)",
                    }}
                  >
                    oreo
                  </span>
                </div>

                {/* Field: User ban */}
                <div style={{ marginBottom: 8 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--sushi-ink)",
                      marginBottom: 2,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    User ban
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--sushi-ink2)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    @wawa · 198765432198765432
                  </div>
                </div>

                {/* Field: Reason */}
                <div style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--sushi-ink)",
                      marginBottom: 2,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Reason
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--sushi-ink2)",
                      fontStyle: "italic",
                    }}
                  >
                    No reason provided.
                  </div>
                </div>

                {/* Footer: Case # */}
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--sushi-ink2)",
                    borderTop: `1px solid ${OUTLINE}`,
                    paddingTop: 8,
                  }}
                >
                  Case #482
                </div>
              </div>

              {/* Action button */}
              <div style={{ marginLeft: 44, paddingBottom: 14 }}>
                <button
                  style={{
                    background: "var(--sushi-card2)",
                    border: `2px solid ${OUTLINE}`,
                    borderRadius: 6,
                    padding: "6px 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--sushi-ink)",
                    fontFamily: "var(--font-body)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span>📝</span> Set reason
                </button>
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
          className="grid grid-cols-1 items-center gap-6 md:grid-cols-[1fr_auto] md:gap-10"
          style={{
            background: "var(--sushi-lilac)",
            border: `3px solid ${OUTLINE}`,
            borderRadius: 28,
            padding: "48px",
            boxShadow: hardShadow(10, 10),
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
              セットアップ · SETUP
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
              Add it. Configure it. Done.
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
              Add the bot, run{" "}
              <code
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  opacity: 1,
                }}
              >
                /settings
              </code>
              , pick your channels. Native bans and kicks log themselves — no
              extra commands needed.
            </p>
            <a
              href={DISCORD_INVITE_URL}
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
