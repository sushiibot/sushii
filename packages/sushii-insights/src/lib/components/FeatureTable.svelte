<script lang="ts">
  import {
    type FeatureSummary,
    featureAudiences,
    featureParts,
  } from "$lib/metrics";
  import type {
    FeatureAudienceRow,
    FeaturePartRow,
    FeaturePeriod,
  } from "$lib/types";

  interface Props {
    features: FeatureSummary[];
    period: FeaturePeriod;
    parts: FeaturePartRow[];
    audiences: FeatureAudienceRow[];
    activeServers: number | null;
  }

  let { features, period, parts, audiences, activeServers }: Props = $props();

  let open = $state<Record<string, boolean>>({});

  const rows = $derived(
    features.map((feature) => ({
      ...feature,
      who: featureAudiences(audiences, period, feature.feature),
      parts: featureParts(parts, period, feature, activeServers),
    })),
  );
  const count = (value: number | null) =>
    value?.toLocaleString() ?? "under 5";
</script>

{#snippet share(adoption: number | null)}
  {#if adoption !== null}
    <div class="share">
      <span class="track">
        <span class="fill" style={`width: ${adoption * 100}%`}></span>
      </span>
      {Math.round(adoption * 100)}%
    </div>
  {:else}
    <span class="muted">hidden</span>
  {/if}
{/snippet}

<div class="scroll">
  <table>
    <thead>
      <tr>
        <th>Feature</th>
        <th>Events by who</th>
        <th class="num">Servers</th>
        <th class="num">Users</th>
        <th class="num">Events</th>
        <th>Share of active servers</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as feature (feature.feature)}
        <tr>
          <td class="name">
            {#if feature.parts.length > 0}
              <button
                type="button"
                class="toggle"
                aria-expanded={open[feature.feature] ?? false}
                onclick={() =>
                  (open[feature.feature] = !open[feature.feature])}
              >
                <span aria-hidden="true">
                  {open[feature.feature] ? "▾" : "▸"}
                </span>
                {feature.feature}
              </button>
            {:else}
              <span class="plain">{feature.feature}</span>
            {/if}
          </td>
          <td class="who muted">
            {feature.who
              .map((who) => `${who.label} ${who.events.toLocaleString()}`)
              .join(" · ")}
          </td>
          <td class="num" data-label="servers">{count(feature.guilds)}</td>
          <td class="num" data-label="users">{count(feature.actors)}</td>
          <td class="num" data-label="events">
            {feature.events.toLocaleString()}
          </td>
          <td class="adoption">{@render share(feature.adoption)}</td>
        </tr>
        {#if open[feature.feature]}
          {#each feature.parts as part (`${part.name}-${part.detail}`)}
            <tr class="part">
              <td class="name" colspan="2">
                {part.name}
                <span class="muted">
                  {part.detail || "each under 5 users"}{#if part.errors > 0}
                    {" "}· {part.errors.toLocaleString()} failed{/if}
                </span>
              </td>
              {#if part.detail}
                <td class="num" data-label="servers">{count(part.servers)}</td>
                <td class="num" data-label="users">{count(part.users)}</td>
              {:else}
                <td class="num" data-label="servers">—</td>
                <td class="num" data-label="users">—</td>
              {/if}
              <td class="num" data-label="events">
                {part.events.toLocaleString()}
              </td>
              <td class="adoption">
                {#if part.detail}{@render share(part.adoption)}{/if}
              </td>
            </tr>
          {/each}
        {/if}
      {/each}
    </tbody>
  </table>
</div>

<style>
  .scroll {
    overflow-x: auto;
  }
  .toggle {
    background: none;
    border: 0;
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: 0;
  }
  .toggle span {
    display: inline-block;
    width: 1rem;
    color: var(--text-muted);
  }
  .plain {
    padding-left: 1rem;
  }
  .muted {
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }
  .part td {
    background: var(--surface-2);
  }
  .part td:first-child {
    padding-left: 1.75rem;
  }
  .share {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-variant-numeric: tabular-nums;
  }
  .track {
    flex: 1;
    min-width: 6rem;
    height: 8px;
    background: var(--grid);
    border-radius: 4px;
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--series-1);
    border-radius: 0 4px 4px 0;
  }

  @media (max-width: 40rem) {
    table {
      display: block;
    }
    thead {
      display: none;
    }
    tbody {
      display: grid;
      grid-template-columns: auto auto minmax(0, 1fr) minmax(4.5rem, 7.5rem);
      column-gap: 0.5rem;
    }
    /* subgrid keeps the stat columns aligned from one feature to the next */
    tr {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      align-items: center;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--grid);
    }
    td {
      border: 0;
      padding: 0;
    }
    .name {
      grid-column: 1 / 4;
      padding-left: 0.5rem;
      white-space: normal;
    }
    .adoption {
      grid-column: 4;
      grid-row: 1;
      padding-right: 0.5rem;
      text-align: right;
    }
    .who {
      grid-column: 1 / -1;
      padding-left: 1.5rem;
    }
    .num {
      grid-row: 3;
      text-align: left;
      white-space: nowrap;
    }
    .num[data-label="events"] {
      grid-column: 3 / 5;
      padding-right: 0.5rem;
    }
    .num::after {
      content: " " attr(data-label);
      color: var(--text-secondary);
      font-size: 0.8125rem;
    }
    .num[data-label="servers"] {
      padding-left: 1.5rem;
    }
    .part {
      background: var(--surface-2);
    }
    .part td:first-child {
      padding-left: 2.25rem;
    }
    .part .name .muted {
      display: block;
    }
    .part .num {
      grid-row: 2;
    }
    .track {
      min-width: 1.5rem;
    }
  }
</style>
