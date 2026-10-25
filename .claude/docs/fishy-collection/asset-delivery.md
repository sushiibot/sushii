> Historical design comparison. The implemented workflow uses the private `sushii-assets` Git repository and deployment GitHub App. See [current asset instructions](../emoji-assets.md).

# Paid asset delivery review

## Recommendation

Store a versioned bundle of required exports in private object storage.
Keep source files outside Git. Keep the manifest, processing scripts, and bundle checksum in Git.
Fetch the pinned bundle during deployment and mount its extracted directory read-only into the worker.
The worker reads local files. It does not need bucket credentials or a download on each catch.

The project already uses an S3 client in `ScamImageStore.ts`.
Reuse the storage technology, but use a separate asset bucket and separate credentials.
This proposal does not assume that an asset bucket already exists.
A private archive copied by the deploy operator is a valid bootstrap alternative.

## Existing workflow

The source pack lives at `~/sushii/assets`, outside this repository.
The mapping in `packages/sushii-worker/scripts/asset-mapping.ts` names source files and emoji IDs.
`encrypt-assets.ts` creates one committed `.png.age` file per mapping.
`BotEmojiName.ts` separately lists allowed emoji names.
`verify-assets.ts` checks encrypted-file existence. `BotEmojiValidator.test.ts` checks enum and file coverage.
The Dockerfile copies the worker directory, including those encrypted files.
Production and staging receive `ASSET_KEY` through deployment secrets templates.
On shard zero, `BotEmojiSyncService` decrypts images, hashes plaintext, and synchronizes application emojis.

The worker declares `age-encryption ^0.3.0`, `discord.js ^14.26.2`, and `@aws-sdk/client-s3 ^3.1063.0`.
This proposal requires no dependency upgrade.

## Specific problems

- Adding an icon changes the mapping, enum, and binary inventory. Silhouettes double many entries.
- Encryption skips existing output. A changed source image requires manual output deletion before replacement.
- Verification checks existence, not whether encrypted output matches the current source or processing recipe.
- The pre-commit check rejects plain PNGs only when matching encrypted files already exist.
  New paid PNGs, SVGs, alternate formats, and images in other folders can bypass that check.
- `.dockerignore` has no dedicated exclusion for private source or generated asset directories.
  An ignored Git file can still enter an image when placed under the copied worker directory.
- The asset loader uses a fixed package path. It does not yet support a mounted asset directory.
- Startup combines image decryption with Discord synchronization. A failed decrypt can stop the entire loading pass.
- The preview server defaults to the runtime's listen address and exposes original files through a path route.
  Its string-prefix path check accepts sibling paths with the same prefix. Restrict future previews to manifest IDs and loopback.
- Emoji replacement deletes the old emoji before creating its replacement. A create failure leaves the old ID unusable.
- Blue and green processes share an application. Per-process shard-zero checks alone do not coordinate overlapping deployments.

These are source-review findings. No production service was queried or changed.

## Proposed files and commands

A single manifest defines stable asset IDs, source paths, export recipes, and license references.
Collection metadata refers to those IDs. Existing UI emoji IDs remain stable.
Generate the runtime asset list and validation inputs from that manifest.
Keep collection assets in their own namespace instead of manually expanding a UI-only enum for every variant.

Proposed commands, not implemented here:

- `assets:build`: read `ASSETS_ROOT`, build selected exports, and calculate hashes.
- `assets:check`: check dimensions, byte limits, alpha, manifest coverage, and hashes.
- `assets:preview`: serve selected exports on loopback, without source-directory traversal.
- `assets:publish`: upload one immutable bundle with publisher credentials.
- `assets:fetch`: fetch the pinned bundle into a private local cache with read-only credentials.

Use a dedicated ignored output directory. Exclude that directory from Docker build context too.
Commit an asset lock file with the bundle key, SHA-256, manifest version, and processing version.
Do not include signed URLs, credentials, or raw image bytes in that lock file.
A content-addressed key avoids mutable `latest` releases and makes rollback explicit.

The bundle contains only selected runtime exports and a manifest. It does not contain original SVGs or the whole purchased pack.
Build silhouettes locally from the alpha mask. Preserve partial alpha and use a fixed foreground color.
Some object assets already include flat black variants; validate those against the chosen color variant before reuse.
The fish set has Outline and No Outline variants, not a complete supplied silhouette set.
No generative image processing is needed.

## Deployment and rollback

The deploy host fetches the asset lock associated with the application release.
It downloads the exact bundle, checks SHA-256, and extracts into a temporary version directory.
Extraction rejects absolute paths, traversal entries, and links outside that directory.
The deploy step checks required files, then atomically publishes the version directory.
Each blue or green slot mounts its own pinned version read-only through a new `ASSET_DIR` setting.
Keep the previous bundle until its application release is no longer a rollback target.

A failed fetch stops activation of the new release. The running release continues using its local files.
A restart with an intact local bundle does not contact object storage.
Deployment credentials can read only the asset bundle location. Publishing uses a separate write-capable identity.
Public CI uses manifest checks and synthetic fixture images; it receives no paid pack or asset credentials.
An authorized release check validates the actual bundle before activation.

No paid plaintext enters Docker layers or shared build caches.
This remains important even if the current image happens to be private; registry visibility was not verified in this review.
Git LFS would keep binaries out of ordinary Git blobs, but would not make a public asset store private.
A private repository could work, but would still require authenticated delivery and duplicate binary history.

## Discord display and asset exposure

Keep application emojis for compact existing UI icons.
For collection artwork, local PNG attachments can supply thumbnails in the catch and collection messages.
This avoids creating application emojis for every color and silhouette pair.
Pagination must replace attachment references correctly and stay within Discord message and component limits.
The implementation must check upload overhead before choosing attachment thumbnails for every entry.
Six entries per page is the proposed starting point.

An alternative is application emojis for all collection variants.
Discord supports up to 2,000 application emojis, so 64 additional variants are not inherently too many.
They still add upload, reconciliation, and replacement lifecycle work.
[Discord emoji documentation](https://docs.discord.com/developers/resources/emoji) describes the limit and app-owned emoji behavior.

Private storage protects the original pack and build exports at rest.
It does not make artwork invisible once displayed in Discord. Recipients can save rendered images and emoji images.
Do not put bundle download links or object-storage credentials into message payloads.

Amazon S3 Block Public Access provides controls that override public policies and ACLs.
Apply the equivalent controls for the selected provider; compatibility APIs do not imply identical security settings.
[Amazon S3 documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html).

Presigned URLs grant temporary access and can be reused until expiration.
They are not a durable privacy boundary for artwork embedded in messages.
Prefer authenticated deployment downloads and local attachments.
[Amazon presigned URL documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).

## License handling

The local `../assets/License.txt` permits project use and modification, and prohibits redistribution of the asset pack.
It also prohibits use in AI or generative art systems. This review uses filenames and metadata, without generative image processing.
The preview contains no purchased artwork.
Retain the purchase license and provenance privately with the source pack.
The vendor page links to a license, but its current license page returned no readable text during this review.
The local license text is the basis for this handling proposal, not a legal conclusion about every Discord distribution scenario.
[Vendor pack page](https://rhosgfx.itch.io/vector-icon-pack).

## Migration

1. Build and validate a bundle containing all current licensed UI icons plus the selected collection assets.
2. Add configurable asset-directory loading while retaining encrypted-file support for rollback.
3. Prepare private storage, deployment fetching, and version-specific mounts in staging.
4. Validate cold deployment, restarts without storage access, and rollback between two bundle versions.
5. Move emoji synchronization into one controlled deployment operation, or add a distributed lock.
6. Preserve working emoji IDs when images match. Avoid delete-first replacement where old messages depend on the ID.
7. Switch production to the mounted bundle, then remove encrypted binaries from the current source tree.
8. Retire `ASSET_KEY` only after the required rollback releases no longer use it.

Removing current binaries does not remove encrypted files from Git history.
No history rewrite is necessary for this proposal, and none is authorized or performed here.
