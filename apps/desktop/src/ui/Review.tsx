import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

export type Review = { risk: "low" | "medium" | "high"; text: string; by: string };

/** The CISO's opinion on an approval: advice only, shown before you decide. */
export function ReviewNote({ review, waiting }: { review?: Review | null; waiting?: boolean }) {
  if (!review)
    return waiting ? (
      <p className="review pending"><ShieldQuestion size={14} aria-hidden="true" /> CISO is reviewing…</p>
    ) : null;
  const Icon = review.risk === "low" ? ShieldCheck : ShieldAlert;
  return (
    <p className={`review ${review.risk}`} role="note">
      <Icon size={14} aria-hidden="true" />
      <span>
        <b>{review.by}: {review.risk} risk.</b> {review.text}
      </span>
    </p>
  );
}
