import type { Metadata } from "next";
import "./canon.css";

export const metadata: Metadata = {
  title: "Reports · Trenchcoat",
  description: "See what your agents did, what they cost, and whether they're working.",
};

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return <div className="tc-reports">{children}</div>;
}
