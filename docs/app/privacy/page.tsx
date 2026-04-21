import type { Metadata } from "next";
import PrivacyContent from "@/content/legal/privacy.md";
import { Footer } from "@/app/_components/Footer";
import { Navbar } from "@/app/_components/Navbar";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for sushii bot",
  openGraph: {
    title: "Privacy Policy",
    description: "Privacy Policy for sushii bot",
    images: [{ url: "/sushii.png", width: 512, height: 512, alt: "sushii" }],
  },
};

export default function PrivacyPage() {
  return (
    <div style={{ background: "var(--sushi-bg)", minHeight: "100vh" }}>
      <Navbar />
      <main className="container mx-auto max-w-3xl px-4 py-12 prose dark:prose-invert">
        <h1>Privacy Policy</h1>
        <PrivacyContent />
      </main>
      <Footer />
    </div>
  );
}
