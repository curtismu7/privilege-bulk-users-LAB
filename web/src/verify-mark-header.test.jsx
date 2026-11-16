import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App.jsx";
import { fakeApi } from "./test-helpers.js";

// The header shows this lab's own Verified / In progress mark, read from the same GET /api/shelf call the Shelf button makes (through the lab-proxy that
// call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
beforeEach(() => { window.location.hash = ""; try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
const shelf = (payload) => fakeApi({ handlers: { "GET /api/shelf": (_b, _s, json) => json(200, payload) } });
const bar = async () => { await screen.findByTestId("guide-page"); return within(screen.getByTestId("shelf-link").closest("header")); };

test("the header shows this lab's own mark, with the note as its tooltip, and no other lab's", async () => {
  shelf({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "privilege-bulk-users", verification: mark("verified", "Verified", { note: "Both routes run on the Mock" }) }] });
  render(<App />);
  const header = await bar();
  expect(await header.findByText("Verified")).toBeInTheDocument();
  expect(document.querySelectorAll(".verify").length).toBe(1);
  expect(header.queryByText("In progress")).toBeNull();
  expect(header.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Both routes run on the Mock"));
  expect(header.getByTestId("shelf-link")).toBeInTheDocument();
});

test("it shows nothing when the lab answers on its own port (only a shelfUrl), the shelf has no mark for it, or the mark is none", async () => {
  for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "privilege-bulk-users", verification: null }] }, { shelfUrl: "http://shelf.example", demos: [{ id: "privilege-bulk-users", verification: mark("none", "") }] }]) {
    const state = shelf(payload);
    const { unmount } = render(<App />);
    await bar();
    await waitFor(() => expect(state.calls.filter((c) => c.url === "/api/shelf").length).toBeGreaterThanOrEqual(2)); // the Shelf button's call and the badge's
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector(".verify")).toBeNull();
    unmount();
  }
});
