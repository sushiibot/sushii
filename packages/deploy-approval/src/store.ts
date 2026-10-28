import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { Candidate } from "./types";

export class Store {
  readonly db: Database;
  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cards(id TEXT PRIMARY KEY, target TEXT NOT NULL, run INTEGER NOT NULL,
        phase TEXT NOT NULL, revision INTEGER NOT NULL, ack INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS cards_target ON cards(target,run);
      CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY, event TEXT NOT NULL, payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS secrets(id TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth(state TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS confirmations(id TEXT PRIMARY KEY, card TEXT NOT NULL, revision INTEGER NOT NULL,
        actor TEXT NOT NULL, decision TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS deployments(target TEXT PRIMARY KEY, sha TEXT NOT NULL, run INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires INTEGER NOT NULL);
    `);
  }
  card(id: string): Candidate | undefined {
    const row = this.db.query("SELECT data FROM cards WHERE id=?").get(id) as {
      data: string;
    } | null;
    return row ? JSON.parse(row.data) : undefined;
  }
  cards(): Candidate[] {
    return (
      this.db.query("SELECT data FROM cards ORDER BY rowid").all() as {
        data: string;
      }[]
    ).map((x) => JSON.parse(x.data));
  }
  save(card: Candidate) {
    this.db
      .query("UPDATE cards SET phase=?, revision=?, data=?, run=? WHERE id=?")
      .run(
        card.phase,
        card.revision,
        JSON.stringify(card),
        card.runId,
        card.id,
      );
  }
  update(card: Candidate, patch: Partial<Candidate>): Candidate {
    const current = this.card(card.id);
    if (!current) throw new Error("Missing card");
    const next = { ...current, ...patch, revision: current.revision + 1 };
    this.save(next);
    return next;
  }
  deployed(repositoryId: number, environmentId: number): string | undefined {
    const row = this.db
      .query("SELECT sha FROM deployments WHERE target=?")
      .get(repositoryId + ":" + environmentId) as { sha: string } | null;
    return row?.sha;
  }
  recordDeployment(
    repositoryId: number,
    environmentId: number,
    sha: string,
    run: number,
  ) {
    if (!/^[a-f0-9]{40}$/.test(sha) || !Number.isSafeInteger(run) || run < 0)
      throw new Error("Invalid deployment baseline");
    this.db.transaction(() => {
      const result = this.db
        .query(
          `INSERT INTO deployments(target,sha,run) VALUES(?,?,?)
        ON CONFLICT(target) DO UPDATE SET sha=excluded.sha,run=excluded.run
        WHERE excluded.run > deployments.run`,
        )
        .run(repositoryId + ":" + environmentId, sha, run);
      if (!result.changes) return;
      for (const card of this.cards().filter(
        (c) =>
          c.repositoryId === repositoryId &&
          c.environmentId === environmentId &&
          c.phase === "pending" &&
          c.previousSha !== sha,
      ))
        this.update(card, { previousSha: sha });
    })();
  }
  candidate(
    incoming: Omit<
      Candidate,
      "id" | "revision" | "phase" | "detail" | "createdAt"
    >,
  ): Candidate | undefined {
    return this.db.transaction(() => {
      const target = incoming.repositoryId + ":" + incoming.environmentId;
      const rows = this.cards().filter(
        (c) =>
          c.repositoryId === incoming.repositoryId &&
          c.environmentId === incoming.environmentId,
      );
      if (rows.some((c) => c.runId > incoming.runId)) return undefined;
      const same = rows.find((c) => c.runId === incoming.runId);
      if (same) return same; // Deliveries never reopen a decided or cancelled candidate.
      const pending = [...rows].reverse().find((c) => c.phase === "pending");
      if (pending)
        return this.update(pending, {
          ...incoming,
          detail: "Waiting for production approval",
        });
      const card: Candidate = {
        ...incoming,
        id: randomUUID(),
        revision: 1,
        createdAt: Date.now(),
        phase: "pending",
        detail: "Waiting for production approval",
      };
      this.db
        .query(
          "INSERT INTO cards(id,target,run,phase,revision,data) VALUES(?,?,?,?,?,?)",
        )
        .run(
          card.id,
          target,
          card.runId,
          card.phase,
          card.revision,
          JSON.stringify(card),
        );
      return card;
    })();
  }
  changed(): Candidate[] {
    return (
      this.db
        .query("SELECT data FROM cards WHERE ack<revision ORDER BY rowid")
        .all() as { data: string }[]
    ).map((x) => JSON.parse(x.data));
  }
  ack(
    id: string,
    revision: number,
    messageId: string,
    threadMessageId?: string,
  ) {
    const card = this.card(id);
    if (!card || revision > card.revision) return;
    // Keep message identity even when a new candidate arrived during the Discord request.
    if (card.messageId && card.messageId !== messageId)
      throw new Error("Conflicting Discord message identity");
    this.save({
      ...card,
      messageId,
      threadMessageId: threadMessageId ?? card.threadMessageId,
    });
    this.db
      .query("UPDATE cards SET ack=MAX(ack,?) WHERE id=?")
      .run(revision, id);
  }
  claim(owner: string): boolean {
    return this.db.transaction(() => {
      const row = this.db
        .query("SELECT owner,expires FROM lease WHERE id=1")
        .get() as { owner: string; expires: number } | null;
      if (row && row.expires > Date.now() && row.owner !== owner) return false;
      this.db
        .query("INSERT OR REPLACE INTO lease VALUES(1,?,?)")
        .run(owner, Date.now() + 45000);
      return true;
    })();
  }
  release(owner: string) {
    this.db.query("DELETE FROM lease WHERE id=1 AND owner=?").run(owner);
  }
  secret(id: string): string | undefined {
    return (
      this.db.query("SELECT value FROM secrets WHERE id=?").get(id) as {
        value: string;
      } | null
    )?.value;
  }
  putSecret(id: string, value: string) {
    this.db.query("INSERT OR REPLACE INTO secrets VALUES(?,?)").run(id, value);
  }
}
