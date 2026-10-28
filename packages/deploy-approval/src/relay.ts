import { Database } from "bun:sqlite";
export class RelayQueue {
  private readonly db: Database;
  private draining = false;
  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,event TEXT NOT NULL,signature TEXT NOT NULL,body BLOB NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,due INTEGER NOT NULL DEFAULT 0,done INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL)",
    );
  }
  enqueue(id: string, event: string, signature: string, body: Uint8Array) {
    this.db.transaction(() => {
      if (this.db.query("SELECT 1 FROM deliveries WHERE id=?").get(id)) return;
      const count = this.db
        .query("SELECT COUNT(*) AS n FROM deliveries WHERE done=0")
        .get() as { n: number };
      if (count.n >= 10000) throw new Error("Relay queue full");
      this.db
        .query(
          "INSERT INTO deliveries(id,event,signature,body,created) VALUES(?,?,?,?,?)",
        )
        .run(id, event, signature, body, Date.now());
    })();
  }
  pending(): number {
    return (
      this.db
        .query("SELECT COUNT(*) AS n FROM deliveries WHERE done=0")
        .get() as { n: number }
    ).n;
  }
  async drain(
    destination: URL,
    token: string,
    transport: typeof fetch = fetch,
  ) {
    if (this.draining) return;
    this.draining = true;
    try {
      const rows = this.db
        .query(
          "SELECT * FROM deliveries WHERE done=0 AND due<=? ORDER BY created LIMIT 20",
        )
        .all(Date.now()) as {
        id: string;
        event: string;
        signature: string;
        body: Uint8Array;
        attempts: number;
      }[];
      for (const row of rows) {
        try {
          const result = await transport(destination, {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(7000),
            headers: {
              authorization: "Bearer " + token,
              "Content-Type": "application/json",
              "x-github-event": row.event,
              "x-github-delivery": row.id,
              "x-hub-signature-256": row.signature,
            },
            body: Buffer.from(row.body),
          });
          if (!result.ok) throw new Error("Backend did not persist delivery");
          this.db
            .query(
              "UPDATE deliveries SET done=1,body=X'',signature='' WHERE id=?",
            )
            .run(row.id);
        } catch {
          this.db
            .query("UPDATE deliveries SET attempts=attempts+1,due=? WHERE id=?")
            .run(
              Date.now() +
                Math.min(300000, 2000 * 2 ** Math.min(row.attempts, 8)),
              row.id,
            );
        }
      }
      this.db
        .query("DELETE FROM deliveries WHERE done=1 AND created<?")
        .run(Date.now() - 7 * 86400000);
    } finally {
      this.draining = false;
    }
  }
  close() {
    this.db.close();
  }
}
