import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">We can&apos;t find that page</h1>
      <p className="mt-2 text-sm text-muted">The agent or protocol may not exist, or it may not be indexed yet.</p>
      <Link href="/leaderboard" className="mt-5 inline-block rounded-[4px] border border-line px-4 py-2 text-sm hover:border-accent/60">
        See the leaderboard
      </Link>
    </div>
  );
}
