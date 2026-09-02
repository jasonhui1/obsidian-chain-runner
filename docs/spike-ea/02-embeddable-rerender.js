// SPIKE Q2 — does an embeddable of a vault note re-render when the note is
//            written by another plugin while the drawing is open?
// Run _setup.js first. Creates spike-stream.md in the vault root.
(async () => {
  const ea = window.__ea;
  if (!ea?.targetView) { console.error("Run _setup.js first"); return; }

  const path = "spike-stream.md";
  let file = app.vault.getAbstractFileByPath(path);
  if (!file) file = await app.vault.create(path, "line 0\n");
  else await app.vault.modify(file, "line 0\n");

  ea.reset();
  ea.addEmbeddable(400, 0, 400, 320, undefined, file);
  await ea.addElementsToView(false, true);

  console.log("=== SPIKE Q2 ===");
  console.log("Embeddable placed at x=400. Shift+1 to zoom to fit. NOW WATCH IT.");
  console.log("Appending a line every 1.5s, 8 times.");

  for (let i = 1; i <= 8; i++) {
    await new Promise(r => setTimeout(r, 1500));
    await app.vault.process(file, (d) => d + `line ${i}\n`);
    console.log(`wrote line ${i}`);
  }
  const final = await app.vault.read(file);
  console.log("file now contains:\n" + final);
  console.log("Q: did lines appear in the embeddable LIVE? (y/n)");
  console.log("If n: click elsewhere then back, or reopen the drawing — do they show then?");
})();
