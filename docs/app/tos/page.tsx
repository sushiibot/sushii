import type { Metadata } from "next";
import TosContent from "@/content/legal/tos.md";
import { Footer } from "@/app/_components/Footer";
import { Navbar } from "@/app/_components/Navbar";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for sushii",
  openGraph: {
    title: "Terms of Service",
    description: "Terms of Service for sushii",
    images: [{ url: "/sushii.png", width: 512, height: 512, alt: "sushii" }],
  },
};

export default function TosPage() {
  return (
    <div style={{ background: "var(--sushi-bg)", minHeight: "100vh" }}>
      <Navbar />
      <main className="container mx-auto max-w-3xl px-4 py-12 prose dark:prose-invert">
        <h1>Terms of Service</h1>
        <TosContent />
      </main>
      <Footer />
    </div>
  );
}
