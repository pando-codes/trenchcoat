import { ReportsView } from "./reports-view";
import { isReportsState } from "./state";

// The core dashboard / reports view (br_db4m9x). Placeholder data only —
// no auth, no backend wiring, per the brief's Non-goals. ?state= makes
// every data state directly reachable for review: loading | empty |
// populated | error (default populated).
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const initialState = isReportsState(state) ? state : "populated";

  return <ReportsView initialState={initialState} />;
}
