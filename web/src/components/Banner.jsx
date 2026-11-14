import React from "react";

// The banner names the mode the header toggle shows, on every page and in presenter mode, and says what is simulated (rule 2).
// In Real, under it: the state that must never be missed, whether writes are enabled.
export function bannerText(mode) {
  if (mode === "mock") {
    return "MOCK mode, simulated. An in-process mock of PingOne and of the Privilege console API answers on this machine (loopback only), with made-up people on .example addresses. Apply changes only that in-memory mock. Nothing leaves this machine.";
  }
  return "REAL mode, owner-run. Plan reads from the PingOne environments and the Privilege console named in this lab's own .env, with its own credentials. Apply creates people and group memberships there. Writes stay off until you turn the Writes switch on.";
}

export default function Banner({ mode, writesEnabled }) {
  return (
    <div data-testid="banner">
      <p className="banner" role="note" data-state={mode === "real" ? "live" : "mock"}>{bannerText(mode)}</p>
      {mode === "real" && (writesEnabled
        ? <p className="notice" data-state="bad" role="alert" data-testid="banner-writes"><strong>WRITES ARE ENABLED.</strong> Apply can create people and group memberships in the real environments.</p>
        : <p className="notice" data-state="ok" role="status" data-testid="banner-writes">Writes are off. Plan only reads; Apply is refused until the Writes switch is on.</p>)}
    </div>
  );
}
