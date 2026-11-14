import React from "react";
import Safe from "./Safe.jsx";

// Why Real cannot be used, in plain words, as visible text (not only a tooltip on a disabled option). Shown on the Run and Help pages
// whenever the server says Real is not available; nothing when it is. The reason and the needs are the server's own words.
export default function RealReason({ info }) {
  if (!info || Boolean(info.realAvailable ?? info.real?.available)) return null;
  // what the reason sentence already says is not listed a second time
  const needs = (Array.isArray(info.real?.needs) ? info.real.needs : []).filter((n) => !String(info.realReason ?? "").includes(String(n)));
  return (
    <div className="notice" data-state="warn" role="status" data-testid="real-reason">
      <p><strong>Real mode is not available on this machine.</strong> <Safe text={info.realReason || "The server did not say why."} multiline /></p>
      {needs.length > 0 && (
        <>
          <p>What it needs:</p>
          <ul>{needs.map((n, i) => <li key={i}><Safe text={n} multiline /></li>)}</ul>
        </>
      )}
      <p>Mock works fully without it, so everything on this page can be tried now.</p>
    </div>
  );
}
