<script lang="ts">
  import {
    RETENTION_WEEKS,
    retentionCohorts,
    retentionFeatures,
  } from "$lib/metrics";
  import type { RetentionRow } from "$lib/types";

  let { rows }: { rows: RetentionRow[] } = $props();

  let unit = $state<RetentionRow["unit"]>("guild");
  let feature = $state("all");

  const features = $derived(
    retentionFeatures(rows.filter((row) => row.unit === unit)),
  );
  const cohorts = $derived(retentionCohorts(rows, unit, feature));

  $effect(() => {
    if (!features.includes(feature)) {
      feature = "all";
    }
  });

  const percent = (rate: number) => `${Math.round(rate * 100)}%`;
  const shade = (rate: number) =>
    `background: color-mix(in oklab, var(--series-1) ${Math.round(rate * 60)}%, var(--surface-1))`;
</script>

<div class="filters">
  <label>
    Measure
    <select bind:value={unit}>
      <option value="guild">Servers</option>
      <option value="user">Users</option>
    </select>
  </label>
  <label>
    Feature
    <select bind:value={feature}>
      {#each features as name (name)}
        <option value={name}>{name}</option>
      {/each}
    </select>
  </label>
</div>

{#if cohorts.length === 0}
  <p class="empty">No data yet for this selection.</p>
{:else}
  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Active in week</th>
          <th class="num">Count</th>
          {#each RETENTION_WEEKS as week (week)}
            <th class="num">Week {week}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each cohorts as cohort (cohort.cohortWeek)}
          <tr>
            <td>{cohort.cohortWeek}</td>
            <td class="num">{cohort.base ?? "under 5"}</td>
            {#each RETENTION_WEEKS as week (week)}
              {@const rate = cohort.rates[week]}
              {#if rate === undefined}
                <td class="num muted" title="Not known yet">·</td>
              {:else if rate === null}
                <td class="num muted" title="Under 5, hidden">—</td>
              {:else}
                <td class="num" style={shade(rate)}>{percent(rate)}</td>
              {/if}
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="note">· not known yet &nbsp; — under 5, hidden</p>
{/if}

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  label {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }
  select {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-2);
    border: 1px solid var(--grid);
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
  }
  .scroll {
    overflow-x: auto;
  }
  .muted {
    color: var(--text-muted);
  }
  .note {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
</style>
