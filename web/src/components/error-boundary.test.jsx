// The vendored ErrorBoundary: byte-pinned (shared/error-boundary), and what it does for a page that cannot be drawn.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { lookup, COUNT_LABEL } from "../lib/status.js";
import { visible, visibleLine } from "../lib/visible.js";

afterEach(cleanup);
const here = path.dirname(fileURLToPath(import.meta.url));

test("the vendored ErrorBoundary matches its sha256 pin and carries its provenance line", () => {
  const text = fs.readFileSync(path.join(here, "error-boundary.sha256"), "utf8");
  expect(text.split("\n")[0]).toMatch(/^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/error-boundary at [0-9a-f]{7,} \(main\); re-vendor, do not edit\.$/);
  const pins = new Map(text.split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => { const [h, f] = l.trim().split(/\s+/); return [f, h]; }));
  expect(pins.get("ErrorBoundary.jsx")).toBe(crypto.createHash("sha256").update(fs.readFileSync(path.join(here, "ErrorBoundary.jsx"))).digest("hex"));
});

const Boom = ({ boom }) => { if (boom) throw new Error("cannot draw"); return <p>fine</p>; };

test("a render error shows a named alert with Try again, and clears when the reset key changes", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { rerender } = render(<ErrorBoundary resetKey="a" message="This page could not be drawn." testId="crash"><Boom boom /></ErrorBoundary>);
  expect(screen.getByTestId("crash")).toHaveAttribute("role", "alert");
  expect(screen.getByTestId("crash")).toHaveTextContent("This page could not be drawn.");
  rerender(<ErrorBoundary resetKey="b" message="This page could not be drawn." testId="crash"><Boom /></ErrorBoundary>);
  expect(screen.getByText("fine")).toBeInTheDocument();
  rerender(<ErrorBoundary resetKey="b" message="x" testId="crash"><Boom boom /></ErrorBoundary>);
  expect(screen.getByTestId("crash")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByTestId("crash")).toBeInTheDocument(); // still broken: it fails again rather than going blank
});

test("lookups keyed by server text answer only own keys", () => {
  for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) expect(lookup(COUNT_LABEL, key), key).toBeUndefined();
  expect(lookup(COUNT_LABEL, "toApply")).toBe("to apply");
  expect(lookup(COUNT_LABEL, 5)).toBeUndefined();
  expect(lookup(COUNT_LABEL, null)).toBeUndefined();
});

test("visible(): control, bidi and zero-width characters become tokens; visibleLine() also tokens tab and newline", () => {
  expect(visible("adm\u202ein\u202d")).toBe("adm‹U+202E›in‹U+202D›");
  expect(visible("a\u200bb\u200cc\u200dd\u2060e\ufeff")).toBe("a‹U+200B›b‹U+200C›c‹U+200D›d‹U+2060›e‹U+FEFF›");
  expect(visible("nul\u0000 del\u007f c1\u0085")).toBe("nul‹U+0000› del‹U+007F› c1‹U+0085›");
  expect(visible("a\nb\tc")).toBe("a\nb\tc");
  expect(visibleLine("a\nb\tc")).toBe("a‹U+000A›b‹U+0009›c");
  expect(visible("plain <b>text</b> é 日本")).toBe("plain <b>text</b> é 日本");
  expect(visible(null)).toBe("");
  expect(visible(42)).toBe("42");
});
