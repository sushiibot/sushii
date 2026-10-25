/** Keep licensed artwork in sushii-assets. Only reviewed free icons belong here. */
const bundledFreeIcons = new Set([
  "member_join.png",
  "member_leave.png",
  "message_delete.png",
  "message_edit.png",
  "shield.png",
  "sound_off.png",
]);
const prefix = "packages/sushii-worker/assets/";
const result = Bun.spawnSync([
  "git",
  "diff",
  "--cached",
  "--name-only",
  "-z",
  "--diff-filter=ACMR",
  "--",
  prefix,
]);
if (result.exitCode !== 0)
  throw new Error("Could not inspect staged asset files");
const blocked = result.stdout
  .toString()
  .split("\0")
  .filter(
    (file) =>
      file.startsWith(prefix) &&
      !bundledFreeIcons.has(file.slice(prefix.length)),
  );
if (blocked.length) {
  console.error(
    "Paid artwork belongs in the private sushii-assets repository.\n" +
      blocked.join("\n"),
  );
  console.error(
    "For a new free icon, review its license and update check-bundled-assets.ts.",
  );
  process.exit(1);
}
