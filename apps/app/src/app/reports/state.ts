export type ReportsState = "loading" | "empty" | "populated" | "error";

export function isReportsState(value: string | undefined): value is ReportsState {
  return value === "loading" || value === "empty" || value === "populated" || value === "error";
}
