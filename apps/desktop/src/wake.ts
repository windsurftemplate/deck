/** Wake word matching for hands-free voice: "deck, what's on today" or "hey deck ..." */
export function matchWake(text: string, word: string): { woke: boolean; request: string } {
  const w = word.trim().toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, "\\s+");
  const m = text.trim().match(new RegExp(`^[\\W_]*(?:(?:hey|hi|ok|okay)[\\W_]+)?${w}\\b[\\s,.:;!?-]*([\\s\\S]*)$`, "i"));
  return m ? { woke: true, request: m[1]!.trim() } : { woke: false, request: "" };
}
