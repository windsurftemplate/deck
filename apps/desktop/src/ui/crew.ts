import { useEffect, useState } from "react";
import { engineCall, onEngineEvent } from "../bridge";

const BUILT_IN: [string, string][] = [["chief-of-staff", "Chief of Staff"], ["gtm", "GTM"], ["ops", "Operations"], ["code", "Engineering"], ["research", "Research"]];

/** Every crew member as [id, name]: the built-in five plus any you created. Updates when the crew changes. */
export function useCrew(): [string, string][] {
  const [custom, setCustom] = useState<[string, string][]>([]);
  useEffect(() => {
    const load = () => void engineCall<{ id: string; name: string }[]>("crew.custom.list").then((l) => setCustom((l ?? []).map((c) => [c.id, c.name]))).catch(() => {});
    load();
    let off: (() => void) | undefined;
    void onEngineEvent((ev) => ev === "crew" && load()).then((u) => (off = u));
    return () => {
      try {
        off?.();
      } catch {
        /* gone */
      }
    };
  }, []);
  return [...BUILT_IN, ...custom];
}
