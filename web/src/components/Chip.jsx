import React from "react";

// A status chip: a word (the children) on a semantic tone. The dot is drawn by CSS.
export default function Chip({ tone, testId, children, ...rest }) {
  return <span className={`chip${tone ? ` chip--${tone}` : ""}`} data-testid={testId} {...rest}>{children}</span>;
}
