<script lang="ts">
  import "layerchart/core.css";
  import "../app.css";

  import { onMount } from "svelte";

  import { invalidateAll } from "$app/navigation";
  import LineChart from "$lib/components/LineChart.svelte";
  import RetentionTable from "$lib/components/RetentionTable.svelte";
  import {
    commandsIn,
    dailyTrend,
    day,
    featureSummaries,
    latestWeek,
    serverLevels,
    totals,
    updatePosts,
    usageOnDay,
    weeklyTrend,
  } from "$lib/metrics";

  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const REFRESH_MS = 60_000;
  const PERIODS = [
    { id: "today", label: "Today" },
    { id: "week", label: "This week so far" },
    { id: "closed", label: "Last closed week" },
  ] as const;

  const USAGE_PERIODS = [
    { id: "today", label: "Today" },
    { id: "week", label: "This week so far" },
    { id: "30d", label: "Last 30 days" },
  ] as const;

  let period = $state<(typeof PERIODS)[number]["id"]>("week");
  let usagePeriod = $state<(typeof USAGE_PERIODS)[number]["id"]>("week");

  const week = $derived(latestWeek(data.usage));
  const today = $derived(usageOnDay(data.daily, day(data.generatedAt)));
  const periodRows = $derived(
    { today, week: data.currentWeek, closed: data.usage }[period],
  );
  const features = $derived(featureSummaries(periodRows));
  const commands = $derived(commandsIn(data.commands, usagePeriod));
  const levels = $derived(serverLevels(data.serverActivity, usagePeriod));
  const posts = $derived(updatePosts(data.updateReach));
  const updatedAt = $derived(data.generatedAt.slice(11, 16));
  const tiles = $derived([
    { label: "Today", row: totals(today) },
    { label: "This week so far", row: totals(data.currentWeek) },
  ]);
  const count = (value: number | null | undefined) =>
    value?.toLocaleString() ?? "under 5";

  onMount(() => {
    const timer = setInterval(() => {
      if (!document.hidden) {
        void invalidateAll();
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  });
</script>

<main>
  <header>
    <h1>sushii insights</h1>
    <p>
      Updated {updatedAt} UTC, refreshes every minute{#if week}{" "}· Latest
        closed week: {week}{/if}
    </p>
  </header>

  <section>
    <h2>Live</h2>
    <div class="tiles">
      {#each tiles as tile (tile.label)}
        <div class="tile">
          <h3>{tile.label}</h3>
          <dl>
            <div><dt>Servers</dt><dd>{count(tile.row?.guilds)}</dd></div>
            <div><dt>Users</dt><dd>{count(tile.row?.actors)}</dd></div>
            <div>
              <dt>Events</dt><dd>{(tile.row?.events ?? 0).toLocaleString()}</dd>
            </div>
          </dl>
        </div>
      {/each}
    </div>
  </section>

  <section>
    <h2>Daily, last 30 days</h2>
    <p class="lede">Days are UTC, and today is still counting.</p>
    <div class="grid">
      <LineChart
        title="Active servers per day"
        unit="Day"
        partialLast
        points={dailyTrend(data.daily, "guilds")}
      />
      <LineChart
        title="Active users per day"
        unit="Day"
        partialLast
        points={dailyTrend(data.daily, "actors")}
      />
      <LineChart
        title="Events per day"
        unit="Day"
        partialLast
        points={dailyTrend(data.daily, "events")}
      />
    </div>
  </section>

  <section>
    <h2>Weekly</h2>
    <p class="lede">Weeks start on Monday, and the open week is marked so far.</p>
    <div class="grid">
      <LineChart
        title="Active servers per week"
        partialLast={data.currentWeek.length > 0}
        points={weeklyTrend(data.usage, data.currentWeek, "guilds")}
      />
      <LineChart
        title="Active users per week"
        partialLast={data.currentWeek.length > 0}
        points={weeklyTrend(data.usage, data.currentWeek, "actors")}
      />
      <LineChart
        title="Events per week"
        partialLast={data.currentWeek.length > 0}
        points={weeklyTrend(data.usage, data.currentWeek, "events")}
      />
    </div>
  </section>

  <section>
    <div class="heading">
      <h2>Features</h2>
      <div class="periods">
        {#each PERIODS as option (option.id)}
          <button
            type="button"
            aria-pressed={period === option.id}
            onclick={() => (period = option.id)}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </div>
    {#if features.length === 0}
      <p class="empty">No feature has reached 5 servers or users in this period.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th class="num">Servers</th>
              <th class="num">Users</th>
              <th class="num">Events</th>
              <th>Share of active servers</th>
            </tr>
          </thead>
          <tbody>
            {#each features as feature (feature.feature)}
              <tr>
                <td>{feature.feature}</td>
                <td class="num">{count(feature.guilds)}</td>
                <td class="num">{count(feature.actors)}</td>
                <td class="num">{feature.events.toLocaleString()}</td>
                <td>
                  {#if feature.adoption !== null}
                    <div class="share">
                      <span class="track">
                        <span
                          class="fill"
                          style={`width: ${feature.adoption * 100}%`}
                        ></span>
                      </span>
                      {Math.round(feature.adoption * 100)}%
                    </div>
                  {:else}
                    <span class="empty">hidden</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section>
    <div class="heading">
      <h2>How much servers use sushii</h2>
      <div class="periods">
        {#each USAGE_PERIODS as option (option.id)}
          <button
            type="button"
            aria-pressed={usagePeriod === option.id}
            onclick={() => (usagePeriod = option.id)}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </div>
    <p class="lede">Servers by how many actions people took in them.</p>
    <div class="tile">
      <dl>
        {#each levels as level (level.level)}
          <div>
            <dt>{level.level} actions</dt>
            <dd>{count(level.servers)}</dd>
          </div>
        {/each}
      </dl>
    </div>
  </section>

  <section>
    <h2>Commands</h2>
    {#if commands.length === 0}
      <p class="empty">No command has reached 5 users in this period.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Command</th>
              <th class="num">Uses</th>
              <th class="num">Users</th>
              <th class="num">Servers</th>
            </tr>
          </thead>
          <tbody>
            {#each commands as row (row.command)}
              <tr>
                <td>{row.command}</td>
                <td class="num">{row.uses.toLocaleString()}</td>
                <td class="num">{row.users.toLocaleString()}</td>
                <td class="num">{count(row.servers)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section>
    <h2>Retention</h2>
    <p class="lede">
      Of those active in a week, the share active again that many weeks later.
    </p>
    <RetentionTable rows={data.retention} />
  </section>

  <section>
    <h2>Prompt funnel</h2>
    {#if data.promptFunnel.length === 0}
      <p class="empty">No data yet.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Week</th><th>Prompt</th><th>Step</th>
              <th class="num">People</th>
            </tr>
          </thead>
          <tbody>
            {#each data.promptFunnel as row (`${row.week}-${row.prompt}-${row.action}`)}
              <tr>
                <td>{day(row.week)}</td>
                <td>{row.prompt}</td>
                <td>{row.action}</td>
                <td class="num">{row.actors.toLocaleString()}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section>
    <h2>Update reach</h2>
    {#if posts.length === 0}
      <p class="empty">No data yet.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Posted</th><th class="num">Sent</th>
              <th class="num">Not sent</th>
            </tr>
          </thead>
          <tbody>
            {#each posts as post (post.postId)}
              <tr>
                <td>{post.postedOn}</td>
                <td class="num">{post.sent.toLocaleString()}</td>
                <td class="num">{post.other.toLocaleString()}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section>
    <h2>Proof</h2>
    {#if data.proof.length === 0}
      <p class="empty">No data yet.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Week</th><th>Added from</th><th class="num">Servers</th>
              <th class="num">Proofs</th>
              <th class="num">Median minutes to proof</th>
            </tr>
          </thead>
          <tbody>
            {#each data.proof as row (`${row.week}-${row.source}`)}
              <tr>
                <td>{day(row.week)}</td>
                <td>{row.source}</td>
                <td class="num">{row.guilds.toLocaleString()}</td>
                <td class="num">{row.proofs.toLocaleString()}</td>
                <td class="num">
                  {row.median_minutes_to_proof === null
                    ? "—"
                    : Math.round(row.median_minutes_to_proof)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</main>

<style>
  main {
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 4rem;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
  }
  h1 {
    font-size: 1.25rem;
    margin: 0;
  }
  header p {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin: 0;
  }
  section {
    margin-top: 2rem;
  }
  h2 {
    font-size: 1rem;
    margin: 0 0 0.75rem;
  }
  h3 {
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    margin: 0 0 0.5rem;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: 1.5rem;
  }
  .tile {
    background: var(--surface-2);
    border-radius: 8px;
    padding: 0.75rem 1rem;
  }
  dl {
    display: flex;
    gap: 2rem;
    margin: 0;
  }
  dt {
    color: var(--text-secondary);
    font-size: 0.75rem;
  }
  dd {
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
    margin: 0;
  }
  .heading {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .heading h2 {
    margin: 0;
  }
  .periods {
    display: flex;
    gap: 0.25rem;
  }
  .periods button {
    background: none;
    border: 1px solid var(--grid);
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.25rem 0.5rem;
  }
  .periods button[aria-pressed="true"] {
    background: var(--surface-2);
    color: var(--text-primary);
  }
  .lede {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin: -0.25rem 0 0.75rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: 1.5rem;
  }
  .scroll {
    overflow-x: auto;
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
</style>
