import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { cardExpired, type Candidate } from "./types";

type NewRelease = Omit<
  Candidate,
  "id" | "revision" | "phase" | "detail" | "createdAt"
>;

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
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
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
  deployed(
    repositoryId: number,
    environmentId: number | string,
    beforeRun?: number,
  ): string | undefined {
    const row = this.db
      .query("SELECT sha,run FROM deployments WHERE target=?")
      .get(repositoryId + ":" + environmentId) as {
      sha: string;
      run: number;
    } | null;
    return row && (beforeRun === undefined || row.run < beforeRun)
      ? row.sha
      : undefined;
  }
  recordDeployment(
    repositoryId: number,
    environmentId: number | string,
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
  expirePending(now = Date.now()): number {
    const expired = this.cards().filter(
      (card) => card.phase === "pending" && cardExpired(card, now),
    );
    for (const card of expired)
      this.update(card, {
        phase: "stale",
        detail:
          "This message is over 24 hours old. Use Refresh for the latest release, or review this run in GitHub.",
      });
    return expired.length;
  }
  private targetCards(
    release: Pick<Candidate, "repositoryId" | "environmentId">,
  ): Candidate[] {
    return this.cards().filter(
      (c) =>
        c.repositoryId === release.repositoryId &&
        c.environmentId === release.environmentId,
    );
  }
  private insertCard(
    incoming: NewRelease,
    phase: "pending" | "deploying",
    existing: Candidate[],
  ): Candidate {
    const card: Candidate = {
      ...incoming,
      id: randomUUID(),
      revision: 1,
      createdAt: Date.now(),
      phase,
      detail:
        phase === "pending"
          ? "Waiting for production approval"
          : "Deployment in progress",
    };
    this.db
      .query(
        "INSERT INTO cards(id,target,run,phase,revision,data) VALUES(?,?,?,?,?,?)",
      )
      .run(
        card.id,
        incoming.repositoryId + ":" + incoming.environmentId,
        card.runId,
        card.phase,
        card.revision,
        JSON.stringify(card),
      );
    for (const old of existing) {
      if (
        ["pending", "stale"].includes(old.phase) &&
        !old.replacedBy &&
        old.runId <= card.runId
      ) {
        this.update(old, {
          phase: "stale",
          replacedBy: card.id,
          detail: "Replaced by a newer approval message.",
        });
      }
    }
    return card;
  }
  // Cards are static: a release only reaches Discord as a new message, which retires older open ones.
  issue(
    incoming: NewRelease,
    reissueAfterMs = Infinity,
    now = Date.now(),
  ): Candidate | undefined {
    return this.db.transaction(() => {
      this.expirePending(now);
      const rows = this.targetCards(incoming);
      const same = rows.filter(
        (c) =>
          c.runId === incoming.runId &&
          c.runAttempt === incoming.runAttempt &&
          !c.replacedBy,
      );
      const decided = same.some((c) => !["pending", "stale"].includes(c.phase));
      const open = same.find((c) => c.phase === "pending");
      if (decided || (open && now - open.createdAt < reissueAfterMs)) {
        return undefined;
      }
      return this.insertCard(incoming, "pending", rows);
    })();
  }
  deploying(incoming: NewRelease): Candidate {
    return this.db.transaction(() => {
      this.expirePending();
      const rows = this.targetCards(incoming);
      const same = rows.find(
        (c) =>
          c.runId === incoming.runId &&
          c.runAttempt === incoming.runAttempt &&
          !c.replacedBy,
      );
      return same ?? this.insertCard(incoming, "deploying", rows);
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
  meta(key: string): string | undefined {
    return (
      this.db.query("SELECT value FROM meta WHERE key=?").get(key) as {
        value: string;
      } | null
    )?.value;
  }
  setMeta(key: string, value: string) {
    this.db.query("INSERT OR REPLACE INTO meta VALUES(?,?)").run(key, value);
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
