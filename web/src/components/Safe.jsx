import React from "react";
import { Untrusted } from "../lib/Untrusted.jsx";
import { visible, visibleLine } from "../lib/visible.js";

// Server text, inert: React text only, with invisible and look-alike control characters shown as ‹U+XXXX›.
export default function Safe({ text, multiline = false, testId }) {
  return <Untrusted text={(multiline ? visible : visibleLine)(text)} testId={testId} />;
}
