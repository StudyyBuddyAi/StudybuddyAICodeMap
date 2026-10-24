/** A plan date as Settings and the redeem toast show it: "Nov 18, 2026". */
export const formatPlanDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
};
