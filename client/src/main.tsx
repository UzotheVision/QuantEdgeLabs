import "./lib/insecure-context-polyfills"; // must run before anything touches crypto.randomUUID
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ErrorBoundary } from "./components/error-boundary";
import { initClientObservability } from "./lib/observability";

// Initialize observability immediately (before any other code can throw)
void initClientObservability();

// Signal to diagnostic script that the module loaded successfully
(window as any).__QE_LOADED = true;

// Global error handler to catch ALL errors including those not caught by React
window.onerror = function(message, source, lineno, colno, error) {
  console.error('=== GLOBAL ERROR ===');
  console.error('Message:', message);
  console.error('Source:', source);
  console.error('Line:', lineno, 'Column:', colno);
  console.error('Error object:', error);
  console.error('Stack:', error?.stack);
  console.error('====================');
  return false;
};

window.onunhandledrejection = function(event) {
  console.error('=== UNHANDLED PROMISE REJECTION ===');
  console.error('Reason:', event.reason);
  console.error('===================================');
};

// Remove the inline HTML loading indicator once React takes over
const appLoader = document.getElementById("app-loader");
if (appLoader) {
  appLoader.style.transition = "opacity 0.3s ease-out";
  appLoader.style.opacity = "0";
  setTimeout(() => appLoader.remove(), 300);
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// PWA installability — the SW is a pure passthrough (no caching; a trading
// terminal must never serve stale bundles). Registered post-load, best-effort.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* not fatal */ });
  });
}
