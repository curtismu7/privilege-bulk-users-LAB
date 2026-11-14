import React, { useRef, useState } from "react";

// A command with a Copy button. The clipboard is optional: without it (or when it refuses) the text is selected so the reader
// can copy it by hand, and the page says so. Never throws.
export default function CodeBlock({ code, label = "curl" }) {
  const [state, setState] = useState("");
  const ref = useRef(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState("copied");
    } catch {
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(ref.current);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch { /* no selection API: the text is still on the page */ }
      setState("manual");
    }
  }
  return (
    <figure className="code" data-testid="code-block">
      <figcaption className="code__bar">
        <span className="code__label">{label}</span>
        <button type="button" onClick={copy} data-testid="copy-btn" aria-label={`Copy the ${label} command`}>Copy</button>
        <span className="code__state" role="status" data-testid="copy-state">
          {state === "copied" ? "Copied." : state === "manual" ? "Copying is not available here. The text is selected: press Ctrl or Cmd + C." : ""}
        </span>
      </figcaption>
      <pre tabIndex={0} aria-label={`${label} command`}><code ref={ref}>{code}</code></pre>
    </figure>
  );
}
