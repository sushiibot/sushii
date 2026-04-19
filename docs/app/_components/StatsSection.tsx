"use client";

import { useEffect, useState } from "react";

interface SushiiStats {
  guild_count: number;
  member_count: number;
  mod_action_count: number;
}

const OUTLINE = "var(--sushi-outline)";
const ON_ACCENT = "#1c1b2e";

const STAT_CONFIG = [
  {
    key: "guild_count" as const,
    label: "Servers Protected",
    accent: "var(--sushi-pink)",
    rotate: -1.5,
  },
  {
    key: "member_count" as const,
    label: "Members Moderated",
    accent: "var(--sushi-lilac)",
    rotate: 1,
  },
  {
    key: "mod_action_count" as const,
    label: "Mod Actions Logged",
    accent: "var(--sushi-blue)",
    rotate: -0.5,
  },
];

function formatStat(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M+`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(0)}K+`;
  }
  return n.toLocaleString();
}

export function StatsSection() {
  const [stats, setStats] = useState<SushiiStats | null>(null);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_SUSHII_STATS_URL;

    if (!apiUrl) {
      return;
    }

    fetch(`${apiUrl}/v1/stats`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SushiiStats | null) => setStats(data))
      .catch(() => {});
  }, []);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 20,
      }}
    >
      {STAT_CONFIG.map(({ key, label, accent, rotate }) => (
        <div
          key={key}
          style={{
            background: accent,
            border: `3px solid ${OUTLINE}`,
            borderRadius: 20,
            padding: "22px 20px",
            boxShadow: `5px 5px 0 ${OUTLINE}`,
            transform: `rotate(${rotate}deg)`,
            color: ON_ACCENT,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 32,
              color: ON_ACCENT,
              lineHeight: 1,
            }}
          >
            {stats ? formatStat(stats[key]) : "—"}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: ON_ACCENT,
              marginTop: 8,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}
