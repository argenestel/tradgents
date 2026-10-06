"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">This page didn&apos;t load</h1>
      <p className="mt-2 text-sm text-muted">The data service didn&apos;t respond, so this page couldn&apos;t load. Try again in a moment.</p>
      {error.digest && <p className="num mt-2 text-[11px] text-muted">ref {error.digest}</p>}
      <button type="button" onClick={reset} className="mt-5 rounded-[4px] bg-accent px-4 py-2 text-sm font-medium text-white">
        Try again
      </button>
    </div>
  );
}
