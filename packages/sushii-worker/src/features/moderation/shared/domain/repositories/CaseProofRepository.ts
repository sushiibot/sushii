import type {
  CaseProof,
  CaseProofSource,
  NewCaseProof,
} from "../entities/CaseProof";

export interface CaseProofCounts {
  entries: number;
  files: number;
}

export interface CaseProofRepository {
  /** Inserts every row in one transaction. */
  add(proofs: NewCaseProof[]): Promise<CaseProof[]>;
  findById(guildId: string, proofId: string): Promise<CaseProof | null>;
  /** The removed row; null when it's already gone. */
  remove(guildId: string, proofId: string): Promise<CaseProof | null>;
  /** Oldest first. */
  listByCase(guildId: string, caseId: string): Promise<CaseProof[]>;
  /** Oldest first per case; cases without proof are absent. */
  listByCases(
    guildId: string,
    caseIds: string[],
  ): Promise<Map<string, CaseProof[]>>;
  /** Cases without proof are absent. */
  countsByCases(
    guildId: string,
    caseIds: string[],
  ): Promise<Map<string, CaseProofCounts>>;
  updateHosting(
    guildId: string,
    proofId: string,
    hosting: { attachments: string[]; hostMessageId: string | null },
  ): Promise<void>;
  latestCreatedAt(
    guildId: string,
    caseIds: string[],
    opts?: { excludeSources?: CaseProofSource[] },
  ): Promise<Date | null>;
}
