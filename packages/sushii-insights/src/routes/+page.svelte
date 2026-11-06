<script lang="ts">
  import "../app.css";

  import LineChart from "$lib/components/LineChart.svelte";
  import RetentionTable from "$lib/components/RetentionTable.svelte";
  import {
    day,
    featureSummaries,
    latestWeek,
    updatePosts,
    weeklyTrend,
  } from "$lib/metrics";

  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const week = $derived(latestWeek(data.usage));
  const features = $derived(featureSummaries(data.usage));
  const posts = $derived(updatePosts(data.updateReach));
  const count = (value: number | null) => value?.toLocaleString() ?? "under 5";
</script>

<main>
  <header>
    <h1>sushii insights</h1>
    {#if week}<p>Latest closed week: {week}</p>{/if}
  </header>

  <section>
    <h2>Activity</h2>
    <div class="grid">
      <LineChart
        title="Active servers per week"
        points={weeklyTrend(data.usage, "guilds")}
      />
      <LineChart
        title="Active users per week"
        points={weeklyTrend(data.usage, "actors")}
      />
    </div>
  </section>

  <section>
    <h2>Features</h2>
    {#if features.length === 0}
      <p class="empty">No data yet.</p>
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
