import { and, asc, eq, inArray, max, notInArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { modLogProofsInAppPublic } from "@/infrastructure/database/schema";

import type {
  CaseProof,
  CaseProofSource,
  NewCaseProof,
} from "../../domain/entities/CaseProof";
import type {
  CaseProofCounts,
  CaseProofRepository,
} from "../../domain/repositories/CaseProofRepository";

type ProofRow = typeof modLogProofsInAppPublic.$inferSelect;

function toBigInt(id: string | null): bigint | null {
  return id === null ? null : BigInt(id);
}

function withoutBlanks(attachments: string[]): string[] {
  return attachments.filter((url) => url.trim() !== "");
}

function mapRow(row: ProofRow): CaseProof {
  return {
    id: row.id.toString(),
    guildId: row.guildId.toString(),
    caseId: row.caseId.toString(),
    authorId: row.authorId?.toString() ?? null,
    createdAt: row.createdAt,
    content: row.content,
    attachments: row.attachments,
    sourceMessageUrl: row.sourceMessageUrl,
    sourceAuthorId: row.sourceAuthorId?.toString() ?? null,
    sourceContent: row.sourceContent,
    hostMessageId: row.hostMessageId?.toString() ?? null,
    source: row.source,
  };
}

export class DrizzleCaseProofRepository implements CaseProofRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async add(proofs: NewCaseProof[]): Promise<CaseProof[]> {
    if (proofs.length === 0) {
      return [];
    }

    const rows = await this.db.transaction((tx) =>
      tx
        .insert(modLogProofsInAppPublic)
        .values(
          proofs.map((proof) => ({
            guildId: BigInt(proof.guildId),
            caseId: BigInt(proof.caseId),
            authorId: toBigInt(proof.authorId),
            createdAt: proof.createdAt,
            content: proof.content,
            attachments: withoutBlanks(proof.attachments),
            sourceMessageUrl: proof.sourceMessageUrl,
            sourceAuthorId: toBigInt(proof.sourceAuthorId),
            sourceContent: proof.sourceContent,
            hostMessageId: toBigInt(proof.hostMessageId),
            source: proof.source,
          })),
        )
        .returning(),
    );

    return rows.map(mapRow);
  }

  async findById(guildId: string, proofId: string): Promise<CaseProof | null> {
    const [row] = await this.db
      .select()
      .from(modLogProofsInAppPublic)
      .where(
        and(
          eq(modLogProofsInAppPublic.guildId, BigInt(guildId)),
          eq(modLogProofsInAppPublic.id, BigInt(proofId)),
        ),
      );

    return row ? mapRow(row) : null;
  }

  async remove(guildId: string, proofId: string): Promise<CaseProof | null> {
    const [row] = await this.db
      .delete(modLogProofsInAppPublic)
      .where(
        and(
          eq(modLogProofsInAppPublic.guildId, BigInt(guildId)),
          eq(modLogProofsInAppPublic.id, BigInt(proofId)),
        ),
      )
      .returning();

    return row ? mapRow(row) : null;
  }

  async listByCase(guildId: string, caseId: string): Promise<CaseProof[]> {
    const rows = await this.db
      .select()
      .from(modLogProofsInAppPublic)
      .where(
        and(
          eq(modLogProofsInAppPublic.guildId, BigInt(guildId)),
          eq(modLogProofsInAppPublic.caseId, BigInt(caseId)),
        ),
      )
      .orderBy(
        asc(modLogProofsInAppPublic.createdAt),
        asc(modLogProofsInAppPublic.id),
      );

    return rows.map(mapRow);
  }

  async listByCases(
    guildId: string,
    caseIds: string[],
  ): Promise<Map<string, CaseProof[]>> {
    const byCase = new Map<string, CaseProof[]>();
    if (caseIds.length === 0) {
      return byCase;
    }

    const rows = await this.db
      .select()
      .from(modLogProofsInAppPublic)
      .where(
        and(
          eq(modLogProofsInAppPublic.guildId, BigInt(guildId)),
          inArray(modLogProofsInAppPublic.caseId, caseIds.map(BigInt)),
        ),
      )
      .orderBy(
        asc(modLogProofsInAppPublic.createdAt),
        asc(modLogProofsInAppPublic.id),
      );

    for (const proof of rows.map(mapRow)) {
      const list = byCase.get(proof.caseId);
      if (list) {
        list.push(proof);
      } else {
        byCase.set(proof.caseId, [proof]);
      }
    }

    return byCase;
  }

  async countsByCases(
    guildId: string,
    caseIds: string[],
  ): Promise<Map<string, CaseProofCounts>> {
    const counts = new Map<string, CaseProofCounts>();
    if (caseIds.length === 0) {
      return counts;
    }

    const rows = await this.db
      .select({
        caseId: modLogProofsInAppPublic.caseId,
        entries: sql<number>`count(*)::int`,
        files: sql<number>`coalesce(sum(cardinality(array_remove(${modLogProofsInAppPublic.attachments}, ''))), 0)::int`,
      })
      .from(modLogProofsInAppPublic)
      .where(
        and(
          eq(modLogProofsInAppPublic.guildId, BigInt(guildId)),
          inArray(modLogProofsInAppPublic.caseId, caseIds.map(BigInt)),
        ),
      )
      .groupBy(modLogProofsInAppPublic.caseId);

    for (const row of rows) {
      counts.set(row.caseId.toString(), {
        entries: Number(row.entries),
        files: Number(row.files),
      });
    }

    return counts;
  }

  async updateHosting(
    guildId: string,
    proofId: string,
    hosting: { attachments: string[]; hostMessageId: string | null },
  ): Promise<void> {
    await this.db
      .update(modLogProofsInAppPublic)
      .set({
        attachments: withoutBlanks(hosting.attachments),
        hostMessageId: toBigInt(hosting.hostMessageId),
      })
      .where(
        and(
          eq(modLogProofsInAppPublic.guildId, BigInt(guildId)),
          eq(modLogProofsInAppPublic.id, BigInt(proofId)),
        ),
      );
  }

  async latestCreatedAt(
    guildId: string,
    caseIds: string[],
    opts: { excludeSources?: CaseProofSource[] } = {},
  ): Promise<Date | null> {
    if (caseIds.length === 0) {
      return null;
    }

    const excluded = opts.excludeSources ?? [];

    const [row] = await this.db
      .select({ latest: max(modLogProofsInAppPublic.createdAt) })
      .from(modLogProofsInAppPublic)
      .where(
        and(
          eq(modLogProofsInAppPublic.guildId, BigInt(guildId)),
          inArray(modLogProofsInAppPublic.caseId, caseIds.map(BigInt)),
          excluded.length > 0
            ? notInArray(modLogProofsInAppPublic.source, excluded)
            : undefined,
        ),
      );

    return row?.latest ?? null;
  }
}
