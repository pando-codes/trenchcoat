import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
}

export function TrenchcoatMark({ className }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      role="img"
      aria-label="Trenchcoat mark"
      className={cn("size-6", className)}
    >
      <path d="M12 12 L32 30" />
      <path d="M52 12 L32 30" />
      <path d="M32 30 L32 54" />
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
