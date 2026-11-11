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
</script>

{#snippet count(value: number | null)}
  {#if value !== null}
    {value.toLocaleString()}
  {:else}
    <span class="wide">under 5</span><span class="narrow">&lt;5</span>
  {/if}
{/snippet}

{#snippet share(adoption: number | null)}
  {#if adoption !== null}
    <div class="share">
      <span class="track">
        <span class="fill" style={`width: ${adoption * 100}%`}></span>
      </span>
      {Math.round(adoption * 100)}%
    </div>
  {:else}
    <span class="muted"
      ><span class="wide">hidden</span><span class="narrow">—</span></span
    >
  {/if}
{/snippet}

<div class="scroll">
  <table>
    <thead>
      <tr>
        <th>Feature</th>
        <th class="who">Events by who</th>
        <th class="num">Servers</th>
        <th class="num">Users</th>
        <th class="num">Events</th>
        <th class="adoption">
          <span class="wide">Share of active servers</span>
          <span class="narrow">Share</span>
        </th>
      </tr>
    </thead>
    <tbody>
      {#each rows as feature (feature.feature)}
        {@const who = feature.who
          .map((who) => `${who.label} ${who.events.toLocaleString()}`)
          .join(" · ")}
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
            <span class="sub muted">{who}</span>
          </td>
          <td class="who muted">{who}</td>
          <td class="num">{@render count(feature.guilds)}</td>
          <td class="num">{@render count(feature.actors)}</td>
          <td class="num">{feature.events.toLocaleString()}</td>
          <td class="adoption">{@render share(feature.adoption)}</td>
        </tr>
        {#if open[feature.feature]}
          {#each feature.parts as part (`${part.name}-${part.detail}`)}
            {@const detail = `${part.detail || "each under 5 users"}${
              part.errors > 0
                ? ` · ${part.errors.toLocaleString()} failed`
                : ""
            }`}
            <tr class="part">
              <td class="name">
                {part.name}
                <span class="sub muted">{detail}</span>
              </td>
              <td class="who muted">{detail}</td>
              {#if part.detail}
                <td class="num">{@render count(part.servers)}</td>
                <td class="num">{@render count(part.users)}</td>
              {:else}
                <td class="num">—</td>
                <td class="num">—</td>
              {/if}
              <td class="num">{part.events.toLocaleString()}</td>
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
  .sub,
  .narrow {
    display: none;
  }

  @media (max-width: 40rem) {
    .who,
    .wide,
    .track {
      display: none;
    }
    .narrow {
      display: inline;
    }
    th,
    td {
      padding-inline: 0.25rem;
    }
    .sub {
      display: block;
      padding-left: 1rem;
    }
    .part .sub {
      padding-left: 0;
    }
    td.name {
      white-space: normal;
    }
    .num {
      white-space: nowrap;
    }
    .adoption {
      text-align: right;
    }
    .share {
      justify-content: flex-end;
    }
  }
</style>
