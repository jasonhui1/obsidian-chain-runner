// SPIKE Q1 — does onLinkClickHook fire for a link inside a boxed text element,
//            and does returning false suppress the default open?
// Run _setup.js first.
(async () => {
  const ea = window.__ea;
  if (!ea?.targetView) { console.error("Run _setup.js first"); return; }
  window.__spike = { fired: [] };

  ea.onLinkClickHook = (element, linkText, event, view, _ea) => {
    const rec = { id: element?.id, type: element?.type,
                  containerId: element?.containerId ?? null, linkText };
    window.__spike.fired.push(rec);
    console.log("HOOK FIRED ->", rec);
    return false;               // docs: false = stop native link handling
  };

  const LINK = "[[SPIKE-TARGET]]";
  const made = {};

  // --- A: link on the CONTAINER of a boxed text -----------------------------
  ea.reset();
  ea.style.strokeColor = "#1971c2";
  const aRet = ea.addText(0, 0, "A  \u25b6 Run (link on box)",
    { box: "box", boxPadding: 12, width: 260, textAlign: "center" });
  {
    const els = ea.getElements();
    const container = els.find(e => e.type !== "text");
    const text = els.find(e => e.type === "text");
    if (container) container.link = LINK;
    made.A = { returnedId: aRet, containerId: container?.id, textId: text?.id, linkOn: "container" };
  }
  await ea.addElementsToView(false, true);

  // --- B: link on the BOUND TEXT itself -------------------------------------
  ea.reset();
  ea.style.strokeColor = "#2f9e44";
  const bRet = ea.addText(0, 140, "B  \u25b6 Run (link on text)",
    { box: "box", boxPadding: 12, width: 260, textAlign: "center" });
  {
    const els = ea.getElements();
    const container = els.find(e => e.type !== "text");
    const text = els.find(e => e.type === "text");
    if (text) text.link = LINK;
    made.B = { returnedId: bRet, containerId: container?.id, textId: text?.id, linkOn: "text" };
  }
  await ea.addElementsToView(false, true);

  // --- C: control, plain rect with a link -----------------------------------
  ea.reset();
  ea.style.strokeColor = "#e03131";
  const cId = ea.addRect(0, 280, 260, 60);
  ea.getElement(cId).link = LINK;
  made.C = { rectId: cId, linkOn: "rect" };
  await ea.addElementsToView(false, true);

  console.log("=== SPIKE Q1 ready ===");
  console.table(made);
  window.__spikeMade = made;
  console.log("Elements now in view:", ea.getViewElements().length);
  console.log("You should SEE three boxes. Zoom to fit: Shift+1");
  console.log("CTRL+CLICK each of A, B, C. Then run: console.table(window.__spike.fired)");
  console.log("Also note: did a tab/popup open for SPIKE-TARGET? It should NOT.");
})();
