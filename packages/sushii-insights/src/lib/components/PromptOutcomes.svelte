<script lang="ts">
  import type { PromptOutcome } from "$lib/metrics";

  let { outcomes }: { outcomes: PromptOutcome[] } = $props();

  const percent = (share: number) => `${Math.round(share * 100)}%`;
</script>

{#each outcomes as outcome (outcome.prompt)}
  <div class="prompt">
    <div class="title">
      <strong>{outcome.prompt}</strong>
      <span>{outcome.shown.toLocaleString()} shown</span>
    </div>
    <div class="bar">
      {#each outcome.segments as segment (segment.id)}
        <span
          class={segment.id}
          style={`flex: ${segment.people}`}
          title={`${segment.label}: ${segment.people}`}
        ></span>
      {/each}
    </div>
    <ul>
      {#each outcome.segments as segment (segment.id)}
        <li>
          <span class={`swatch ${segment.id}`}></span>
          {segment.label}
          <b>{segment.people.toLocaleString()}</b>
          ({percent(segment.share)})
        </li>
      {/each}
    </ul>
  </div>
{/each}

<style>
  .prompt {
    margin-bottom: 1.25rem;
  }
  .title {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.75rem;
    font-size: 0.875rem;
    margin-bottom: 0.375rem;
  }
  .title span {
    color: var(--text-secondary);
  }
  .bar {
    display: flex;
    gap: 2px;
    height: 1.5rem;
  }
  .bar span {
    min-width: 4px;
  }
  .bar span:first-child {
    border-radius: 4px 0 0 4px;
  }
  .bar span:last-child {
    border-radius: 0 4px 4px 0;
  }
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }
  b {
    color: var(--text-primary);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .swatch {
    display: inline-block;
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 2px;
    margin-right: 0.125rem;
  }
  .completed {
    background: var(--series-1);
  }
  .started {
    background: color-mix(in srgb, var(--series-1) 45%, var(--grid));
  }
  .snoozed,
  .dismissed {
    background: var(--text-muted);
  }
  .no_response,
  .hidden {
    background: var(--grid);
  }
</style>
