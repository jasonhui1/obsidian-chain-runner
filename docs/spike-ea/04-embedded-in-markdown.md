# SPIKE Q4 — do EA hooks fire when the drawing is embedded in a markdown note?

Manual, no script beyond re-running Q1's hook.

1. Create a note `spike-host.md` containing exactly:

   ```
   Text above.

   ![[<name of your scratch drawing>]]

   Text below.
   ```

2. Close the drawing's own tab entirely. Open `spike-host.md` in **Reading** view.
3. In the console, run `_setup.js` again (the embedded drawing is a different view
   instance), then re-install the hook only — no element creation:

   ```js
   window.__spike = { fired: [] };
   window.__ea.onLinkClickHook = (el, linkText) => {
     window.__spike.fired.push({ id: el?.id, type: el?.type, linkText });
     console.log("HOOK FIRED (embedded) ->", linkText);
     return false;
   };
   ```

4. Ctrl+Click box **A** and box **B** inside the embedded drawing.
5. Record: `console.table(window.__spike.fired)` — and whether a tab opened.
6. Repeat in **Live Preview** view. Note if the two modes differ.
