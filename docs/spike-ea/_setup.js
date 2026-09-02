// Run this FIRST, and again any time you see "targetView not set".
// Requires: an Excalidraw drawing tab open. Click the drawing once before pasting.
(() => {
  const p = app.plugins.plugins["obsidian-excalidraw-plugin"];
  const ea = window.ExcalidrawAutomate ?? p?.ea;
  if (!ea) { console.error("No ExcalidrawAutomate found"); return; }
  let view = null;
  try { view = ea.setView("active"); } catch (e) { console.warn("setView('active') threw:", e); }
  if (!ea.targetView) { try { view = ea.setView("first"); } catch (e) { console.warn("setView('first') threw:", e); } }
  window.__ea = ea;
  if (!ea.targetView) {
    console.error("STILL no targetView. Open an Excalidraw drawing tab, click on it, re-run.");
    return;
  }
  console.log("OK — targetView:", ea.targetView.file?.path,
              "| elements in view:", ea.getViewElements().length,
              "| plugin", p.manifest.version);
})();
