import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import type { ReactNode } from "react";
import { source } from "@/lib/source";

function TrenchcoatMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className="h-4 w-4 text-[#C8832A]"
      aria-hidden="true"
    >
      <path d="M12 12 L32 30" />
      <path d="M52 12 L32 30" />
      <path d="M32 30 L32 54" />
    </svg>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: (
          <a href="https://trenchcoat.io" className="flex items-center gap-2">
            <TrenchcoatMark />
            <span className="font-semibold" style={{ letterSpacing: "-0.04em" }}>
              trenchcoat
            </span>
          </a>
        ),
      }}
      links={[
        {
          text: "Dashboard",
          url: "https://app.trenchcoat.io",
          external: true,
        },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
