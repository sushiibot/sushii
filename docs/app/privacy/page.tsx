import type { Metadata } from "next";
import PrivacyContent from "@/content/legal/privacy.md";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for sushii bot",
};

export default function PrivacyPage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12 prose dark:prose-invert">
      <PrivacyContent />
    </main>
  );
}
