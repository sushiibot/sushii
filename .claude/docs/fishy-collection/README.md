# Fishy collections

Implementation, 25 October 2026. Adds personal collections to the existing fishy command.
The runtime catalog is `src/features/social/domain/collection/catalog.json` in the worker package.
This directory retains the original balance simulation and source-art mappings.

## Scope

Each successful `/fishy` records one collectible for the caller. The target receives fishy points, as today.
Existing points do not create collection entries. Collections start empty and remain global across servers.

The launch catalog contains 32 collectibles: 24 aquatic creatures and eight objects.
The [symbol shortlist](symbols.md) maps existing artwork to navigation, conditions, and discovery markers.
Six sets organize the collection. Sets have progress counts, but no completion rewards.
There is no trading, equipment, location selection, profile showcase, or size system.

`/rank [user]` and `/fishycollection [user]` open the same interface on different tabs.
Both tabs retain the target user. Rank retains its server context; Collection shows global discoveries.
The collection supports set selection and pagination. Names remain visible for undiscovered entries.
Discovered entries show color artwork and counts. Undiscovered entries show silhouettes and their rarity labels.

## Catalog and biological accuracy

[catalog.json](catalog.json) contains stable IDs, source paths, sets, rarity, weights, habitat, and condition preferences.
Every listed source file exists in the local purchased pack. No paid image is copied into this proposal.

The catalog is an editable game proposal, not a claim about global wildlife abundance.
Source-backed examples anchor the common and exceptional ends. Other entries explicitly retain provisional rationales.
Koi are ornamental carp, so their rare tier is a collection choice. It does not imply biological scarcity.
Broad asset names, including salmon, eel, sea bass, arowana, and giant catfish, do not establish exact species.
Do not attach species-specific conservation claims to those names without identification.

The evidence supports these limited conclusions:

- [Wisconsin DNR](https://dnr.wisconsin.gov/topic/Fishing/species/bluegill.html) describes widespread bluegill distribution and accessible angling in Wisconsin. Common is our game inference.
- [NOAA](https://www.fisheries.noaa.gov/species/red-snapper) describes red snapper as a marine fishery species. Its game tier is not a stock assessment.
- [Smithsonian](https://nationalzoo.si.edu/animals/arapaima) describes large Amazon floodplain fish. Epic reflects an exceptional encounter, rather than measured global scarcity.
- [Smithsonian Ocean](https://ocean.si.edu/ocean-life/fish/coelacanth) describes coelacanth discovery history and restricted living lineages. Legendary is a thematic interpretation.

Fish not selected for launch remain available for later catalog versions.
This includes overlapping bass sizes, ambiguous giant fish, and regional species that need more identification work.
The old fictional and patron names are retired from the reveal, as requested.
Their internal reward buckets remain only to preserve the existing points distribution.

## Catch selection

First select a rarity tier. Then select an item within that tier.
The tier probabilities do not depend on conditions, streaks, points, or other users.

| Tier | Probability |
| --- | ---: |
| Common | 50% |
| Uncommon | 28% |
| Rare | 15% |
| Epic | 5% |
| Legendary | 2% |

Every item starts with weight 100 within its tier. Its preferred condition multiplies that weight by 1.2.
The effective probability is tier probability multiplied by item weight divided by total effective weight in that tier.
The multiplier changes relative weight, not the final probability by exactly 20%.
All items remain available under all conditions. These preferences are game flavor, not claims about real weather effects.

The five conditions are still waters, light rain, heavy rain, rolling mist, and moonlit waters.
Each lasts four hours. A deterministic shuffle includes each condition once per 20-hour block.
Use the block number and a fixed schedule version as the seed. All servers compute the same condition.
A repeated condition across block boundaries is allowed. Avoiding repeats adds complexity without improving the main experience.
Do not seed catch rolls from the shared schedule. Use independent random draws for each accepted catch.
Use rejection sampling or another unbiased bounded draw when implementing weighted integer selection.

The 20-hour block avoids a fixed 24-hour pattern. It does not guarantee every condition for each player's schedule.
A single-item tier cannot change its item probability with conditions. Coelacanth therefore remains exactly 2% in this draft.

Habitat supplies flavor after selection. It is not another random gate or an action for the player.
Sets are browsing groups, not exact ecosystems. Water Wonders intentionally combines several habitats.

## Points and legacy behavior

Keep existing fishy balances and the 12-hour cooldown.
Streaks continue to affect points only. They do not multiply collection entries or change rarity probabilities.

For the first implementation, preserve the current reward distribution with a separate points roll.
Display the new collectible and the awarded points, without implying a fixed sale value for that collectible.
This avoids changing the economy while introducing collection odds.
The old catch-type text is no longer displayed.
A future rarity-based points system requires its own distribution comparison.

## Balance results

Run `bun .claude/docs/fishy-collection/simulate.mjs` from the repository root.
The script uses only catalog metadata. Results are in [simulation-results.json](simulation-results.json).

The simulation uses 10,000 players per cadence, independent catch draws, varied starting windows, and the proposed deterministic condition schedule.
It models exactly one or two catches daily. It excludes missed days, trading, and duplicate protection.
The catch limit is 5,000. No simulated player reaches that limit without completing the collection.
These are game simulations, not observed player behavior or guarantees.

| Milestone | Median catches | 90th percentile | 95th percentile |
| --- | ---: | ---: | ---: |
| Discover 16 of 32 | 22 | 27 | 28 |
| Complete any set | 36 | 54 | 60 |
| Complete all sets, daily cadence | 146 | 231 | 265 |
| Complete all sets, twice daily cadence | 146 | 231 | 267 |

At one catch daily, catch counts roughly equal days. At two catches daily, the calendar time is roughly half.
The median player discovers 19 items after 30 catches, and 30 items after 100 catches.
Completion still has a long tail. The proposed launch pace is a months-long collection, with smaller sets completing earlier.
If the desired pace is weeks, reduce the catalog or change collection cadence before making individual fish exceptionally rare.

Coelacanth provides an independent arithmetic check: at 2%, its expected first catch takes 50 attempts.
Its median first catch is 35 attempts; 95% of players encounter it by 149 attempts.
The full collection takes longer because all the other entries must also appear.
Adding items dilutes their tier unless probabilities or weights change. Re-run the model for every catalog revision.

## Storage and consistency

Add `user_fishy_collection` with `user_id`, `collectible_id`, `catch_count`, `first_caught_at`, and `last_caught_at`.
Use `(user_id, collectible_id)` as the primary key. Require positive counts and reference the user record.
The catalog remains versioned configuration. Validate collectible IDs on write; never reuse an old ID for a different item.
An entry records a type and count, not a tradeable inventory object.

One transaction must claim the caller's cooldown, update their streak, record the catch, and increment the recipient's points.
Use atomic increments and row locks or a conditional cooldown update. Lock user rows in stable ID order to prevent reciprocal-gift deadlocks.
Create missing user rows safely before taking those locks. Handle self-fishing as one user row.
Do not reuse full-profile saves that can overwrite concurrent rep or fishy updates.
Use the insert result to determine first discovery. A separate pre-read can race.

A repeated interaction must not produce another catch. If delivery fails after commit, retry the response without awarding again.
The `app_private.fishy_interaction_results` table stores committed reveals by Discord interaction ID.
Retries of the same interaction return that result without rerolling or awarding again.

## Implementation and validation

- All 32 color icons and 32 silhouettes are exported in the private asset repository.
- Collection pages use native Components V2 sections with one artwork thumbnail per catch. Names, rarity, and counts remain native text on mobile. Tabs, filters, and pagination sit inside the same container.
- `/rank` and `/fishycollection` share a session. Controls expire after five idle minutes or fourteen total minutes.
- Fishy and rep updates lock users in numeric ID order and update only their relevant columns.
- Drizzle generated `0064_fishy_collection.sql`. Existing balances are not backfilled into collections.
- Tests cover tier boundaries, availability, concurrent catches, replay, reciprocal gifts, rollback, cooldown boundaries, pagination, ownership, and expired controls.

The previews contain placeholders, with no paid artwork. They are saved under
`/home/drk/github/claude-notes/sushii/previews/` as `fishy-collection-flow.html` and `fishy-collection-implementation.html`.
