/** Turn free text into a safe FTS5 query: quoted words joined with OR. */
export function ftsQuery(text: string): string | null {
  const words = Array.from(new Set(text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])).slice(0, 16);
  return words.length ? words.map((w) => `"${w}"`).join(" OR ") : null;
}

/** Same word splitting, for adapters without FTS (keyword scoring in code). */
export function words(text: string): string[] {
  return Array.from(new Set(text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []));
}
