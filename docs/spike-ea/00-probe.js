// SPIKE Q0 — which EA handle exists, and what version?
// Paste into Obsidian DevTools console (Ctrl+Shift+I -> Console) with a drawing open.
(() => {
  const p = app.plugins.plugins["obsidian-excalidraw-plugin"];
  const out = {
    pluginFound: !!p,
    pluginVersion: p?.manifest?.version,
    "window.ExcalidrawAutomate": typeof window.ExcalidrawAutomate,
    "plugin.ea": typeof p?.ea,
  };
  const ea = window.ExcalidrawAutomate ?? p?.ea;
  out.eaResolved = !!ea;
  if (ea) {
    out.hasOnLinkClickHook = "onLinkClickHook" in ea;
    out.verifyMinimumPluginVersion_2_0_0 = ea.verifyMinimumPluginVersion?.("2.0.0");
    out.targetViewSet = !!ea.targetView;
    out.methods = ["addText","addRect","addEmbeddable","addElementsToView","getElement","setView","reset","getExcalidrawAPI"]
      .filter(m => typeof ea[m] === "function");
  }
  console.log("=== SPIKE Q0 ===");
  console.table(out);
  window.__ea = ea;              // reused by later scripts
  return out;
})();
