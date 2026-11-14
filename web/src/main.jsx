import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { visible } from "./lib/visible.js";
import "./styles/standalone-ui.css";
import "./top-menu/top-menu.css";
import "./app.css";

// The shared JsonView uses this guard for every string it draws (its own contract: window.__safeTextVisible).
window.__safeTextVisible = visible;

createRoot(document.getElementById("root")).render(<App />);
