import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
}

export function TrenchcoatMark({ className }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      fill="currentColor"
      role="img"
      aria-label="Trenchcoat mark"
      className={cn("size-6", className)}
    >
      {/* Registered canon mark (br_id7k2a): a two-rect "T" — crossbar + stem, */}
      {/* centered on x=50. Glyph only (no tile) so it inherits currentColor. */}
      <rect x="18" y="18" width="64" height="16" rx="4" ry="4" />
      <rect x="41" y="18" width="18" height="64" rx="3" ry="3" />
    </svg>
  );
}

export function TrenchcoatLockup({ className }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <TrenchcoatMark className="size-5 shrink-0 text-primary" />
      <span
        className="text-[1.125rem] font-semibold leading-none"
        style={{ letterSpacing: "-0.04em" }}
      >
        trenchcoat
      </span>
    </div>
  );
}

export function TrenchcoatStackedLockup({ className }: LogoProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <TrenchcoatMark className="size-10 text-primary" />
      <span
        className="text-2xl font-semibold leading-none"
        style={{ letterSpacing: "-0.04em" }}
      >
        trenchcoat
      </span>
    </div>
  );
}
