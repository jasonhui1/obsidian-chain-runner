// SPIKE Q3b — the real check: after a full CLOSE + REOPEN, are all the rects still there?
// Tolerates 03-save-race.js having been run several times (N runs -> N*40 rects).
// STEPS:
//   1. Note the "in-memory scene: X/40" number printed by your last 03 run.
//   2. CLOSE the drawing tab completely. REOPEN it. Click the empty canvas.
//   3. Paste _setup.js, then paste this, then answer the prompt in the console.
(async () => {
  const ea = window.__ea;
  if (!ea?.targetView) { console.error("Run _setup.js first"); return; }
  const view = ea.targetView;

  const rects = ea.getViewElements().filter(e => e.customData?.spike !== undefined);
  const idx = new Set(rects.map(e => e.customData.spike));
  const missing = [...Array(40).keys()].filter(i => !idx.has(i));

  const raw = await app.vault.read(view.file);
  const fmt = raw.includes("```compressed-json") ? "compressed-json"
            : raw.includes("```json") ? "plain json" : "unknown";

  console.log("=== SPIKE Q3b ===");
  console.log("file:", view.file.path, "| storage format:", fmt);
  console.log("spike rects surviving close+reopen:", rects.length);
  console.log("runs this implies:", rects.length / 40, "(should be a whole number)");
  console.log("distinct indices 0-39 present:", idx.size, "/40");
  console.log(missing.length ? "MISSING: " + missing.join(",") : "no gaps");

  const clean = rects.length % 40 === 0 && idx.size === 40;
  console.log(clean
    ? `LOOKS CLEAN — compare ${rects.length} against the "in-memory scene" number from your last 03 run.\n` +
      "  same number  -> PASS, addElementsToView(save=true) in a tight loop loses nothing\n" +
      "  fewer        -> FAIL, report both numbers"
    : "FAIL — uneven count or gaps, report the numbers above");
})();
