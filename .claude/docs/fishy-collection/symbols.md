# Collection symbol shortlist

This shortlist uses filenames and file metadata from the purchased pack. All 24 source paths exist.
Artwork has not been visually reviewed. No paid images are copied into the repository.

## Recommended first pass

Use the book, fishing rod, sparkle, and five condition symbols. Reuse the existing rank and clock emojis.
Keep duplicate counts as text, such as Caught 8. Keep rarity labels readable without color.
Set icons and rarity stars are optional additions after checking the layout at Discord sizes.

## Candidates

| Purpose | Source path | Notes |
| --- | --- | --- |
| Collection tab and collection header | `Items/Book/Book Outline 256.png` | Use one book variant consistently. |
| Fishy action and empty collection | `Tools/Fishing Rod/Fishing Rod Outline 256.png` | Decorative symbol only; no equipment mechanic. |
| New discovery marker | `General/Sparkle/Sparkle Outline 256.png` | Pair with the words New discovery; omit on duplicates. |
| Still waters | `Nature/Pond/Pond Outline 256.png` | Condition symbol, not a selectable location. |
| Light rain | `Nature/Rain/Rain Outline 256.png` | Keep the condition name beside the icon. |
| Heavy rain candidate | `Nature/Storm/Storm Outline 256.png` | Filename suggests a storm. Check artwork before treating it as rain without lightning. |
| Rolling mist fallback | `Nature/Cloud/Cloud Outline 256.png` | No dedicated fog or mist asset found. Cloud is an approximation. |
| Moonlit waters | `Nature/Moon/Moon Outline 256.png` | No actual local-time meaning. |
| River Catches set | `Transport/Rowboat/Rowboat Outline 256.png` | Theme symbol, not travel or boat ownership. |
| Sea Life set | `Items/Anchor/Anchor Outline 256.png` | Theme symbol, not an equipped item. |
| Water Wonders set | `Tools/Compass/Compass Outline 256.png` | Optional discovery theme. |
| Odd Catches set | `Tools/Bucket/Bucket Outline 256.png` | Avoid reusing a collectible icon as navigation when possible. |
| Shore and Treasure set | `Items/Seashell/Seashell Outline 256.png` | Also a collectible. Use a label to distinguish the set. |
| Previous page | `UI/Arrow/Arrow Left Outline 256.png` | Optional; existing labeled buttons may be enough. |
| Next page | `UI/Arrow/Arrow Right Outline 256.png` | Match Previous style. |
| Discovered or completed set | `UI/Check Mark/Check Mark Outline 256.png` | Already mapped as success/enabled; reuse existing emoji. |
| Missing-art fallback | `UI/Question Mark/Question Mark Outline 256.png` | Normal undiscovered entries use the actual species silhouette. |
| Cooldown or first caught date | `Tools/Clock/Clock Outline 256.png` | Already mapped as duration; no new upload required. |
| Rank tab | `General/Trophy/Trophy Outline 256.png` | Already mapped as rankings. |
| Optional Common marker | `General/Star/Star Bronze Outline 256.png` | Proposal only; pair with text. |
| Optional Uncommon marker | `General/Star/Star Silver Outline 256.png` | Proposal only; pair with text. |
| Optional Rare marker | `General/Star/Star Blue Outline 256.png` | Proposal only; pair with text. |
| Optional Epic marker | `General/Star/Star Purple Outline 256.png` | Proposal only; pair with text. |
| Optional Legendary marker | `General/Star/Star Gold Outline 256.png` | Star shape is also used for rep. Text-only rarity may be clearer. |

## Other families available

- Books have red, green, purple, and brown variants. One collection book is enough for launch.
- Gems have blue, green, red, and yellow variants. Crystals include blue and purple variants.
- The bonus Coin Tiers folder has eight numbered designs, each with outlined and unoutlined files.
- Moon phases offer eight variants. Do not add a moon-phase mechanic just to use the artwork.
- Fishing rods include a blue variant. Buckets include water, milk, and lava variants.
- Chests have multiple sizes and styles. They are useful for catches but can imply rewards when used as navigation.

Avoid coins or gems as rarity markers initially. They can suggest another currency or a purchase.
Do not use a gift box or trade symbol while collection gifting and trading remain out of scope.

## Asset workflow

Place selected artwork and generated exports in the proposed private asset repository.
Keep stable symbol IDs and references in the bot repository; pin the asset repository commit with each bot release.
Use small application emojis for inline symbols and button icons, following the existing UI icon pattern.
Collection artwork can use local attachments. Do not upload a second copy of existing clock, trophy, or check-mark emojis.

## Next visual check

Compare condition symbols at small sizes, especially rain versus storm.
Check whether the star family can be distinguished from the rep star.
Check silhouettes on dark and light backgrounds before selecting their final fill color.
