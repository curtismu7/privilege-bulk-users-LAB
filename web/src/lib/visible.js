// Server text is only ever drawn as React text nodes (never markup). On top of that, characters a reader cannot see (control,
// bidirectional overrides, zero-width and invisible joiners) are shown as <U+XXXX> tokens, so "adm<RLO>in" cannot pass for "admni" and a
// zero-width space cannot pass for nothing. The same guard feeds the shared JsonView (see main.jsx), so tables and JSON panes agree.
const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\ufff9-\ufffb]/g;
const token = (c) => `\u2039U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}\u203a`;

// Keeps tab and newline: for text that is meant to have lines (messages, and the JSON text the JsonView prints).
export const visible = (v) => String(v ?? "").replace(HIDDEN, token);
// For one-line places (table cells, chips, labels): a tab or newline is shown as well.
export const visibleLine = (v) => visible(v).replace(/[\t\n]/g, token);
