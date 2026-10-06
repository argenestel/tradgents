import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-muted">That agent, protocol or page doesn&apos;t exist (or hasn&apos;t been indexed yet).</p>
      <Link href="/leaderboard" className="mt-5 inline-block rounded-[4px] border border-line px-4 py-2 text-sm hover:border-accent/60">
        Browse the leaderboard
      </Link>
    </div>
  );
}
