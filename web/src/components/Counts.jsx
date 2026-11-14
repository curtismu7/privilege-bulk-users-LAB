import React from "react";
import Chip from "./Chip.jsx";
import { COUNT_LABEL, TONE, lookup, testKey } from "../lib/status.js";
import { visibleLine } from "../lib/visible.js";

// The counts of a job as chips with plain labels. Keys come from the server as they are; one with no label here shows its key
// (as visible text). Lookups are own-key only: a key like "__proto__" is just an unlabelled key.
export default function Counts({ counts }) {
  const entries = counts && typeof counts === "object" ? Object.entries(counts) : [];
  return (
    <ul className="counts" data-testid="counts" aria-label="Counts">
      {entries.map(([key, n]) => (
        <li key={key}><Chip tone={lookup(TONE, key)} testId={`count-${testKey(key)}`} data-count={String(n)}><strong>{String(n)}</strong> {lookup(COUNT_LABEL, key) ?? visibleLine(key)}</Chip></li>
      ))}
    </ul>
  );
}
