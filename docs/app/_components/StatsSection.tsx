"use client";

import { useEffect, useState } from "react";

interface SushiiStats {
  guild_count: number;
  member_count: number;
  mod_action_count: number;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-fd-border bg-fd-card p-4 text-center">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-sm text-fd-muted-foreground">{label}</div>
    </div>
  );
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
    <div className="grid grid-cols-3 gap-4">
      <StatCard
        label="Servers"
        value={stats?.guild_count?.toLocaleString() ?? "—"}
      />
      <StatCard
        label="Members"
        value={stats?.member_count?.toLocaleString() ?? "—"}
      />
      <StatCard
        label="Mod Actions"
        value={stats?.mod_action_count?.toLocaleString() ?? "—"}
      />
    </div>
  );
}
