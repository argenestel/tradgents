export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <div className="h-8 w-64 animate-pulse rounded bg-surface" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-surface" />
      <div className="h-64 animate-pulse rounded-[4px] border border-line bg-surface" />
      <div className="h-40 animate-pulse rounded-[4px] border border-line bg-surface" />
    </div>
  );
}
