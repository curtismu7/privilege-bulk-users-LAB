// The vendored JsonPane (rule 24): byte-pinned to the canonical copy, and the one way a JSON pane is drawn in this app.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import JsonPane, { setJsonView } from "./JsonPane.jsx";

beforeEach(() => setJsonView("form"));
afterEach(cleanup);
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(here, f))).digest("hex");
const pinOf = (file) => fs.readFileSync(path.join(here, file), "utf8").trim().split(/\s+/)[0];

test("the vendored JsonPane and its stylesheet match their sha256 pins (rule 24: never hand-edit a copy; re-vendor from shared/json)", () => {
  expect(sha("JsonPane.jsx"), "JsonPane.jsx differs from JsonPane.sha256").toBe(pinOf("JsonPane.sha256"));
  expect(sha("JsonPane.css"), "JsonPane.css differs from JsonPane.css.sha256").toBe(pinOf("JsonPane.css.sha256"));
});

test("no JSON pane is hand-rolled: nothing outside the vendored JsonPane stringifies JSON into the page", () => {
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.jsx$/.test(name) || /\.test\.jsx$/.test(name) || name === "JsonPane.jsx") continue;
      if (/JSON\.stringify/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(src, p));
    }
  };
  walk(src);
  expect(hits).toEqual([]);
});

test("it draws Formatted (a form) by default, switches to Raw and back, and Raw is the exact JSON text", () => {
  const value = { username: "ada.example", active: true, n: 3, nested: { id: "11111111-2222-4333-8444-555555555555" } };
  render(<JsonPane value={value} label="Example" testId="demo" />);
  const box = screen.getByTestId("demo-box");
  expect(box).toHaveAttribute("data-view", "form");
  expect(screen.getByTestId("demo-formatted")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("demo-raw")).toHaveAttribute("aria-pressed", "false");
  const form = screen.getByTestId("demo");
  expect(form).toHaveAttribute("aria-label", "Example");
  expect(within(form).getByText("username")).toBeInTheDocument();
  expect(within(form).getByText("ada.example")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("demo-raw"));
  expect(box).toHaveAttribute("data-view", "raw");
  expect(screen.getByTestId("demo-raw")).toHaveAttribute("aria-pressed", "true");
  const pre = screen.getByTestId("demo");
  expect(pre.tagName).toBe("PRE");
  expect(pre).toHaveAttribute("aria-label", "Example");
  expect(pre.textContent).toBe(JSON.stringify(value, null, 2));
  fireEvent.click(screen.getByTestId("demo-formatted"));
  expect(box).toHaveAttribute("data-view", "form");
});

test("hostile strings are text, and control, bidi and zero-width characters show as visible escapes, in both views", () => {
  render(<JsonPane value={{ username: "<img src=x onerror=alert(1)>", note: "a\u0000b‮c", name: "admin​" }} testId="bad" />);
  const check = (el) => {
    expect(document.querySelector("img")).toBeNull();
    expect(el).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(el).toHaveTextContent("‹U+202E›");
    expect(el).toHaveTextContent("‹U+200B›");
    expect(el.textContent).not.toContain("‮");
    expect(el.textContent).not.toContain("​");
  };
  const form = screen.getByTestId("bad");
  check(form);
  expect(form).toHaveTextContent("‹U+0000›"); // Formatted draws the character itself through visible(); Raw has JSON's own \u0000 escape
  fireEvent.click(screen.getByTestId("bad-raw"));
  check(screen.getByTestId("bad"));
});

test("a key such as __proto__ or constructor is a label like any other and cannot break the pane", () => {
  const value = JSON.parse('{"__proto__": {"x": 1}, "constructor": "c", "toString": null}');
  render(<JsonPane value={value} testId="keys" />);
  const form = screen.getByTestId("keys");
  expect(form).toHaveTextContent("__proto__");
  expect(form).toHaveTextContent("constructor");
  expect(form).toHaveTextContent("toString");
  fireEvent.click(screen.getByTestId("keys-raw"));
  expect(screen.getByTestId("keys")).toHaveTextContent('"__proto__"');
});

test("a plain string is shown as it is, with no toggle", () => {
  render(<JsonPane value="just text" testId="txt" />);
  expect(screen.getByTestId("txt-box")).toHaveAttribute("data-view", "text");
  expect(screen.queryByTestId("txt-formatted")).toBeNull();
  expect(screen.getByTestId("txt")).toHaveTextContent("just text");
});
