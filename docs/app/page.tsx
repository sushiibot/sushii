import Link from "next/link";
import { StatsSection } from "./_components/StatsSection";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold">sushii</h1>
        <p className="mt-2 text-lg text-fd-muted-foreground">
          Complete Discord Community Management
        </p>
      </div>

      <StatsSection />

      <Link
        href="/docs"
        className="rounded-md bg-fd-primary px-6 py-3 text-fd-primary-foreground hover:opacity-90"
      >
        Read the Docs
      </Link>
    </main>
  );
}
