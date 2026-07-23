function Pulse({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse motion-reduce:animate-none rounded-[var(--tc-radius-md)] ${className}`}
      style={{ backgroundColor: "var(--tc-surface-2)", ...style }}
      aria-hidden="true"
    />
  );
}

// Mirrors the populated layout's shape so the loading → populated
// transition doesn't jump. Reachable via the state switcher (br_db4m9x
// "Fails if" #1).
export function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading reports…</span>
      <Pulse style={{ height: 84 }} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Pulse style={{ height: 112 }} />
        <Pulse style={{ height: 112 }} />
        <Pulse style={{ height: 112 }} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Pulse style={{ height: 288 }} />
        <Pulse style={{ height: 288 }} />
      </div>
      <Pulse style={{ height: 220 }} />
    </div>
  );
}
