import type { ClusterClient } from "discord-hybrid-sharding";

declare module "discord.js" {
  interface Client {
    cluster: ClusterClient;
  }
}
