<script lang="ts">
  import { LineChart } from "layerchart/svg";

  import type { Point } from "$lib/metrics";

  const MAX_POINTS_WITH_DOTS = 8;

  let {
    title,
    points,
    unit = "Week",
    partialLast = false,
  }: {
    title: string;
    points: Point[];
    unit?: string;
    /** Dashes the line into the last point, which is still counting. */
    partialLast?: boolean;
  } = $props();

  const showDots = $derived(points.length <= MAX_POINTS_WITH_DOTS);
  // Local midnight: the axis formats local dates, and UTC parsing shows a day early.
  const data = $derived(
    points.map((point, index) => ({
      date: new Date(`${point.label.slice(0, 10)}T00:00`),
      value: point.value,
      counting: partialLast && index === points.length - 2,
    })),
  );
</script>

<figure>
  <figcaption>{title}</figcaption>
  {#if points.length === 0}
    <p class="empty">No data yet.</p>
  {:else}
    <div
      class="plot"
      role="img"
      aria-label={`${title}, latest ${points.at(-1)?.value}`}
    >
      <LineChart
        {data}
        x="date"
        y="value"
        series={[{ key: "value", label: title, color: "var(--series-1)" }]}
        points={showDots}
        padding={{ left: 44, bottom: 28, top: 4, right: 12 }}
        props={{
          spline: { class: (d) => (d.counting ? "line counting" : "line") },
          xAxis: {
            ticks: showDots ? data.map((d) => d.date) : undefined,
            format: (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`,
          },
          yAxis: { format: "metric" },
        }}
      />
    </div>
    <details>
      <summary>Table</summary>
      <table>
        <thead><tr><th>{unit}</th><th class="num">Count</th></tr></thead>
        <tbody>
          {#each points as point (point.label)}
            <tr><td>{point.label}</td><td class="num">{point.value}</td></tr>
          {/each}
        </tbody>
      </table>
    </details>
  {/if}
</figure>

<style>
  figure {
    margin: 0;
    min-width: 0;
  }
  figcaption {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
  }
  .plot {
    height: 12rem;
    --color-surface-content: var(--text-secondary);
    --color-surface-100: var(--surface-2);
  }
  .plot :global(.lc-axis-tick-label) {
    font-size: 12px;
  }
  .plot :global(.line) {
    stroke-width: 2;
  }
  .plot :global(.counting) {
    stroke-dasharray: 4 4;
  }
  details {
    color: var(--text-secondary);
    font-size: 0.8125rem;
    margin-top: 0.25rem;
  }
  .empty {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0;
  }
</style>
