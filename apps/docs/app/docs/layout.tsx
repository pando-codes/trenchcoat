import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import type { ReactNode } from "react";
import { source } from "@/lib/source";
import { Book } from "lucide-react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: (
          <span className="flex items-center gap-2 font-semibold">
            <Book className="h-4 w-4" />
            Trenchcoat
          </span>
        ),
        url: "https://trenchcoat.io",
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
