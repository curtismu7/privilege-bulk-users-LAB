import React, { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api.js";
import Banner from "./components/Banner.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import Audit from "./pages/Audit.jsx";
import Diagram from "./pages/Diagram.jsx";
import Guide from "./pages/Guide.jsx";
import Help from "./pages/Help.jsx";
import Run from "./pages/Run.jsx";
import { PresentBar, PresentProvider, usePresent } from "./present/Present.jsx";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu.jsx";

// The family launcher address, used only when this server has no shelf URL of its own (GET /api/shelf answers null).
const FAMILY_SHELF = "https://local.ping-devops.com:8443/";
const NAV = [["guide", "Guide"], ["run", "Run"], ["diagram", "Diagram"], ["audit", "Audit"]];
const PAGES = new Set([...NAV.map(([id]) => id), "help"]);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } },
};
// Hash routing. The Guide is the front page: no hash, an empty one or an unknown one all land there.
const parseHash = () => { const [, page = ""] = window.location.hash.replace(/^#/, "").split("/"); return { page: PAGES.has(page) ? page : "guide" }; };

export default function App() {
  return <PresentProvider><Shell /></PresentProvider>;
}

function Shell() {
  const { present, set: setPresent } = usePresent();
  const [fontStep, setFontStep] = useState(() => { const f = store.get("pbu.font"); return ["S", "M", "L"].includes(f) ? f : "M"; });
  useEffect(() => { applyFontSize(fontStep); store.set("pbu.font", fontStep); }, [fontStep]);
  const [route, setRoute] = useState(parseHash);
  const [theme, setTheme] = useState(() => { const t = store.get("pbu.theme"); return ["auto", "light", "dark"].includes(t) ? t : "auto"; });
  const [info, setInfo] = useState(null); // GET /api/info; null = not known yet
  const [infoError, setInfoError] = useState(null); // { code, message } when /api/info could not be read
  const [mode, setModeState] = useState("mock");
  const [refusal, setRefusal] = useState("");
  const [epoch, setEpoch] = useState(0); // bumped by Reset: remounts the page, so every control, poll and diagram box starts over
  const [shelfUrl, setShelfUrl] = useState(FAMILY_SHELF);
  const [msg, setMsg] = useState("");
  const say = useCallback((m) => setMsg(m), []);
  const realOk = Boolean(info?.realAvailable ?? info?.real?.available);

  // The server decides the mode (rule 19); the page follows what /api/info says. Read on load, after Reset and after a switch.
  const refreshInfo = useCallback(async () => {
    const r = await api.get("/api/info");
    if (r.ok && r.json) { setInfo(r.json); setInfoError(null); setModeState(r.json.source === "real" ? "real" : "mock"); }
    else { setInfo(null); setInfoError(api.failure(r)); }
  }, []);
  useEffect(() => { refreshInfo(); }, [refreshInfo]);
  // The Shelf button points where the server says (GET /api/shelf); the family default only when it has nothing (null) or cannot be read.
  useEffect(() => {
    let alive = true;
    api.get("/api/shelf").then((r) => { if (alive && r.ok && typeof r.json?.shelfUrl === "string" && r.json.shelfUrl.trim()) setShelfUrl(r.json.shelfUrl.trim()); });
    return () => { alive = false; };
  }, []);

  // The header toggle. The server decides: while its Real guards do not pass the Real option is disabled (and the reason is on the Run
  // and Help pages), and a switch it refuses (409) is shown as its own message, with the page staying where it was.
  const setMode = async (m) => {
    const r = await api.post("/api/mode", { source: m });
    if (!r.ok) { setRefusal(api.failure(r).message); return; }
    setRefusal("");
    await refreshInfo();
  };

  useEffect(() => { const f = () => setRoute(parseHash()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  // After a route change, focus goes to the new page's heading, so a keyboard or screen-reader user starts at the top of what they opened
  // (not at the link they pressed, nor on the page body). Not on the first render, and not when the hash did not change the page.
  const shownPage = useRef(route.page);
  useEffect(() => {
    if (shownPage.current === route.page) return;
    shownPage.current = route.page;
    const h1 = document.querySelector("#main h1");
    if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus(); }
  }, [route.page]);
  useEffect(() => { if (theme === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; store.set("pbu.theme", theme); }, [theme]);

  async function reset() {
    const r = await api.post("/api/reset");
    setEpoch((n) => n + 1);
    await refreshInfo();
    say(r.ok ? "Reset: the job, the audit history and the Writes switch are cleared, and the diagram is restored." : `Reset failed: ${api.failure(r).message}`);
  }

  const page = (() => {
    switch (route.page) {
      case "run": return <Run info={info} infoError={infoError} mode={mode} onWrites={(on) => setInfo((i) => ({ ...i, writesEnabled: on }))} say={say} />;
      case "diagram": return <Diagram theme={theme === "auto" ? "system" : theme} />;
      case "audit": return <Audit />;
      case "help": return <Help info={info} />;
      default: return <Guide />;
    }
  })();

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <header className="shell-bar">
        <span className="shell-brand"><span className="shell-logo" aria-hidden="true">P</span>Privilege Bulk Users LAB</span>
        <nav className="shell-nav" aria-label="Pages">
          {NAV.map(([id, label]) => <a key={id} href={`#/${id}`} data-testid={`nav-${id}`} aria-current={route.page === id ? "page" : undefined}>{label}</a>)}
        </nav>
        <TopMenu
          mode={{ value: mode, onChange: setMode, realAvailable: info ? realOk : null, realHint: info && !realOk ? (info.realReason || "Real is refused.") : undefined }}
          theme={{ value: theme, onChange: setTheme }}
          fontSize={{ value: fontStep, onChange: setFontStep }}
          present={{ active: present, onToggle: () => setPresent(!present) }}
          shelfUrl={shelfUrl}
          help={{ href: "#/help", onClick: (e) => { e.preventDefault(); window.location.hash = "#/help"; } }}
          onReset={reset}
        >
          <span className="chip" data-testid="mode">Mode: {mode}</span>
        </TopMenu>
      </header>
      <PresentBar />
      <main id="main" className="page" tabIndex={-1}>
        <Banner mode={mode} writesEnabled={Boolean(info?.writesEnabled)} />
        {refusal && <p className="notice" data-state="bad" role="alert" data-testid="refusal">{refusal}</p>}
        <div key={epoch}>
          <ErrorBoundary resetKey={route.page} testId="page-crash" message="This page could not be drawn, so nothing is shown here. The header, the banner and the other pages still work, and Reset starts everything over.">{page}</ErrorBoundary>
        </div>
      </main>
      <p className="visually-hidden" role="status" aria-live="polite" data-testid="live">{msg}</p>
      <footer className="foot">This app runs on your machine and has no accounts. Settings and secrets live in this lab's own .env and are never sent to the page. Product claims are marked UNVERIFIED where we have not verified them (see the Guide and Help).</footer>
    </>
  );
}
