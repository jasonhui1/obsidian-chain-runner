// SPIKE Q3 — does addElementsToView(..., save=true) race autosave / lose elements?
// Run _setup.js first. Use a FRESH scratch drawing (adds 40 rects).
// Signature: addElementsToView(repositionToCursor=false, save=true, newElementsOnTop=false, shouldRestoreElements?)
(async () => {
  const ea = window.__ea;
  if (!ea?.targetView) { console.error("Run _setup.js first"); return; }
  const view = ea.targetView;
  const N = 40;

  console.log("=== SPIKE Q3 === before:", ea.getViewElements().length, "| adding", N, "in a tight loop");
  const results = [];
  for (let i = 0; i < N; i++) {
    ea.reset();
    const id = ea.addRect((i % 10) * 60, 400 + Math.floor(i / 10) * 60, 50, 50);
    ea.getElement(id).customData = { spike: i };
    const ok = await ea.addElementsToView(false, true);   // save=true each time
    results.push(ok);
  }
  console.log("addElementsToView returned false", results.filter(r => r === false).length, "times");

  const inMem = ea.getViewElements().filter(e => e.customData?.spike !== undefined).length;
  console.log(`in-memory scene: ${inMem}/${N} spike rects`);

  if (typeof view.save === "function") await view.save();
  await new Promise(r => setTimeout(r, 3000));           // let autosave settle
  const raw = await app.vault.read(view.file);
  const onDisk = (raw.match(/"spike"/g) || []).length;
  console.log(`file on disk:   ${onDisk}/${N} spike rects`);
  console.log(inMem === N && onDisk === N
    ? "PASS — nothing lost"
    : `FAIL — inMem=${inMem} onDisk=${onDisk} of ${N}`);
  console.log("Now CLOSE and REOPEN the drawing, run _setup.js, then:");
  console.log("  window.__ea.getViewElements().filter(e=>e.customData?.spike!==undefined).length");
})();
