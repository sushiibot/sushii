export const CASE_PROOF_SOURCES = [
  "action",
  "button",
  "command",
  "context_menu",
  "backfill",
] as const;

export type CaseProofSource = (typeof CASE_PROOF_SOURCES)[number];

export interface CaseProof {
  id: string;
  guildId: string;
  caseId: string;
  authorId: string | null;
  createdAt: Date;
  content: string | null;
  attachments: string[];
  sourceMessageUrl: string | null;
  sourceAuthorId: string | null;
  sourceContent: string | null;
  hostMessageId: string | null;
  source: CaseProofSource;
}

export type NewCaseProof = Omit<CaseProof, "id" | "createdAt"> & {
  createdAt?: Date;
};

export const PROOF_CONTENT_MAX_LENGTH = 1000;
export const PROOF_SOURCE_CONTENT_MAX_LENGTH = 2000;
export const PROOF_FILES_PER_CASE_MAX = 10;
