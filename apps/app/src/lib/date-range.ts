export function parseDateRange(
  from?: string,
  to?: string
): { p_from: string; p_to: string } {
  const now = new Date();
  return {
    p_from:
      from ??
      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .substring(0, 10),
    p_to: to ?? now.toISOString().substring(0, 10),
  };
}
