// The vendored JsonView (rule 24): byte-pinned to the canonical copy, and the one way a JSON pane is drawn in this app.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { afterEach, expect, test } from "vitest";
import JsonView from "./JsonView.jsx";

afterEach(cleanup);
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..");

test("the vendored JsonView matches its sha256 pin (rule 24: never hand-edit the copy; re-vendor from shared/json)", () => {
  const pins = new Map(fs.readFileSync(path.join(here, "json-view.sha256"), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => { const [h, f] = l.trim().split(/\s+/); return [f, h]; }));
  expect([...pins.keys()]).toEqual(["JsonView.jsx"]);
  expect(fs.readFileSync(path.join(here, "json-view.sha256"), "utf8").split("\n")[0]).toMatch(/^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/json at [0-9a-f]{7,} \(main\); re-vendor, do not edit\.$/); // provenance, like the other pins
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(here, "JsonView.jsx"))).digest("hex");
  expect(actual, "JsonView.jsx differs from json-view.sha256 (hand-edited copy, or re-vendored without regenerating the pin)").toBe(pins.get("JsonView.jsx"));
});

test("no JSON pane is hand-rolled: nothing outside the vendored JsonView stringifies JSON into the page", () => {
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { if (name !== "json") walk(p); continue; }
      if (!/\.jsx$/.test(name) || /\.test\.jsx$/.test(name)) continue;
      if (/JSON\.stringify/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(src, p));
    }
  };
  walk(src);
  expect(hits).toEqual([]);
});

test("it draws a value colored by default, switches to Raw and back, and keeps the same text", () => {
  render(<JsonView value={{ username: "ada.example", active: true, n: 3, nested: { id: "11111111-2222-4333-8444-555555555555" } }} label="Example" testId="demo" />);
  const toggle = screen.getByTestId("demo-toggle");
  expect(toggle).toHaveTextContent("Colored");
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  const pre = screen.getByTestId("demo-pre");
  expect(pre).toHaveAttribute("aria-label", "Example");
  expect(pre).toHaveTextContent('"username": "ada.example"');
  fireEvent.click(toggle);
  expect(toggle).toHaveTextContent("Raw");
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(pre.textContent).toBe(JSON.stringify({ username: "ada.example", active: true, n: 3, nested: { id: "11111111-2222-4333-8444-555555555555" } }, null, 2));
  fireEvent.click(toggle);
  expect(toggle).toHaveTextContent("Colored");
});

test("hostile strings are text, and control and bidi characters show as visible escapes, in both modes", () => {
  render(<JsonView value={{ username: "<img src=x onerror=alert(1)>", note: "a\u0000b\u202ec" }} testId="bad" />);
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByTestId("bad-pre")).toHaveTextContent("<img src=x onerror=alert(1)>");
  expect(screen.getByTestId("bad-pre")).toHaveTextContent("‹U+0000›");
  expect(screen.getByTestId("bad-pre")).toHaveTextContent("‹U+202E›");
  fireEvent.click(screen.getByTestId("bad-toggle")); // Raw: JSON escapes the NUL itself; the bidi override still becomes a visible token
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByTestId("bad-pre")).toHaveTextContent("<img src=x onerror=alert(1)>");
  expect(screen.getByTestId("bad-pre")).toHaveTextContent("‹U+202E›");
  expect(screen.getByTestId("bad-pre").textContent).not.toContain("\u202e");
});

test("with the lab's guard on window (main.jsx), the JsonView also escapes zero-width characters, and keeps the JSON's own line breaks in Raw", async () => {
  const { visible } = await import("../lib/visible.js");
  window.__safeTextVisible = visible;
  try {
    render(<JsonView value={{ name: "admin\u200b", other: "<img src=x>" }} testId="zw" />);
    expect(screen.getByTestId("zw-pre")).toHaveTextContent("admin‹U+200B›");
    fireEvent.click(screen.getByTestId("zw-toggle"));
    expect(screen.getByTestId("zw-pre").textContent).toBe('{\n  "name": "admin‹U+200B›",\n  "other": "<img src=x>"\n}');
    expect(document.querySelector("img")).toBeNull();
  } finally { delete window.__safeTextVisible; }
});
