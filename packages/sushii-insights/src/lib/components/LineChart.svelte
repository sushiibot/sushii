<script lang="ts">
  import type { Point } from "$lib/metrics";

  let {
    title,
    points,
    unit = "Week",
  }: { title: string; points: Point[]; unit?: string } = $props();

  const width = 560;
  const height = 180;
  const pad = { top: 16, right: 48, bottom: 24, left: 8 };

  let hovered = $state<number | null>(null);

  const max = $derived(Math.max(...points.map((p) => p.value), 1));
  const x = (i: number) =>
    pad.left +
    (i / Math.max(points.length - 1, 1)) * (width - pad.left - pad.right);
  const y = (value: number) =>
    height - pad.bottom - (value / max) * (height - pad.top - pad.bottom);
  const path = $derived(
    points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" "),
  );
  const last = $derived(points.at(-1));
  const active = $derived(hovered === null ? null : points[hovered]);

  function onMove(event: PointerEvent) {
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const slot = (ratio * width - pad.left) / (width - pad.left - pad.right);
    const index = Math.round(slot * (points.length - 1));
    hovered = Math.min(Math.max(index, 0), points.length - 1);
  }
</script>

<figure>
  <figcaption>{title}</figcaption>
  {#if points.length === 0}
    <p class="empty">No data yet.</p>
  {:else}
    <div class="plot">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title}, latest ${last?.value}`}
        onpointermove={onMove}
        onpointerleave={() => (hovered = null)}
      >
        <line
          class="axis"
          x1={pad.left}
          x2={width - pad.right}
          y1={height - pad.bottom}
          y2={height - pad.bottom}
        />
        <text class="tick" x={pad.left} y={height - 6}>{points[0].label}</text>
        <path class="line" d={path} />
        {#if points.length === 1}
          <circle class="dot" cx={x(0)} cy={y(points[0].value)} r="4" />
        {/if}
        {#if last}
          <text class="end" x={x(points.length - 1) + 8} y={y(last.value) + 4}>
            {last.value.toLocaleString()}
          </text>
        {/if}
        {#if active && hovered !== null}
          <line
            class="crosshair"
            x1={x(hovered)}
            x2={x(hovered)}
            y1={pad.top}
            y2={height - pad.bottom}
          />
          <circle class="dot" cx={x(hovered)} cy={y(active.value)} r="4" />
        {/if}
      </svg>
      {#if active && hovered !== null}
        <div
          class="tooltip"
          style={`left: ${(x(hovered) / width) * 100}%`}
          class:flip={hovered > points.length / 2}
        >
          <span>{active.label}</span>
          <strong>{active.value.toLocaleString()}</strong>
        </div>
      {/if}
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
    margin-bottom: 0.25rem;
  }
  .plot {
    position: relative;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    touch-action: none;
  }
  .axis {
    stroke: var(--grid);
    stroke-width: 1;
  }
  .tick {
    fill: var(--text-muted);
    font-size: 11px;
  }
  .line {
    fill: none;
    stroke: var(--series-1);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .end {
    fill: var(--text-primary);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .crosshair {
    stroke: var(--text-muted);
    stroke-width: 1;
  }
  .dot {
    fill: var(--series-1);
    stroke: var(--surface-1);
    stroke-width: 2;
  }
  .tooltip {
    position: absolute;
    top: 0;
    transform: translateX(8px);
    display: flex;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    background: var(--surface-2);
    border: 1px solid var(--grid);
    border-radius: 4px;
    font-size: 0.75rem;
    white-space: nowrap;
    pointer-events: none;
  }
  .tooltip.flip {
    transform: translateX(calc(-100% - 8px));
  }
  .tooltip span {
    color: var(--text-secondary);
  }
  details {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
</style>
