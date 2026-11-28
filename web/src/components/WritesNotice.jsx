import React from "react";

// In Real: the state that must never be missed, whether writes are enabled. The simulation paragraph that used to sit above it is the
// Real-or-mock modal now (mode-modal/, rendered in App.jsx).
export default function WritesNotice({ mode, writesEnabled }) {
  if (mode !== "real") return null;
  return (
    <div>
      {writesEnabled
        ? <p className="notice" data-state="bad" role="alert" data-testid="writes-notice"><strong>WRITES ARE ENABLED.</strong> Apply can create people and group memberships in the real environments.</p>
        : <p className="notice" data-state="ok" role="status" data-testid="writes-notice">Writes are off. Plan only reads; Apply is refused until the Writes switch is on.</p>}
    </div>
  );
}
