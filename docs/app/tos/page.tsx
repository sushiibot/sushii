import type { Metadata } from "next";
import TosContent from "@/content/legal/tos.md";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for sushii",
};

export default function TosPage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12 prose dark:prose-invert">
      <TosContent />
    </main>
  );
}
