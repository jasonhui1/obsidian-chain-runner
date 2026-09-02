# Spike #2 runbook — de-risk the ExcalidrawAutomate integration

Throwaway. Nothing here ships. Output is `docs/spike-ea.md`.

## Setup (once)

1. A **scratch vault** (not your real one) — Settings > About > "Open another vault".
2. Community plugins on, install **Excalidraw**, enable it.
3. Note the version: Settings > Community plugins > Excalidraw. Write it down.
4. New drawing: command palette > "Excalidraw: Create new drawing". Call it `spike`.
5. Open DevTools: `Ctrl+Shift+I`, go to the **Console** tab.

Every script is pasted into that console with the drawing tab **focused**.

## Order

**Before every script**, click on the drawing, then paste `_setup.js`. It calls
`ea.setView("active")` — without it every EA call fails with
"targetView not set, or no longer active".

| Step | File | You do |
|---|---|---|
| — | `_setup.js` | paste before each script below |
| Q0 | `00-probe.js` | paste, copy the table |
| Q1 | `01-link-hook.js` | paste, then Ctrl+Click boxes A, B, C |
| Q2 | `02-embeddable-rerender.js` | paste, watch the embeddable for ~15s |
| Q3 | `03-save-race.js` | paste into a **fresh** drawing, read the PASS/FAIL |
| Q4 | `04-embedded-in-markdown.md` | follow the steps in that file |

## What to send back to me

For each of Q0–Q4: the console output (copy-paste text is better than a screenshot),
plus the one-line "what I saw with my eyes" — did a tab open, did text appear live.

Gotchas:
- Excalidraw links usually need **Ctrl+Click** (Cmd on Mac), or clicking the small link
  icon on the element. A plain click just selects. If nothing fires, try both.
- "targetView not set" = re-run `_setup.js`. It goes stale whenever you switch tabs
  or reopen the drawing. When in doubt, run it again; it is harmless.
- After a script runs, press **Shift+1** in the drawing to zoom-to-fit — the boxes are
  placed at fixed coordinates that may be off-screen.
- Q3 writes 40 rects; use a throwaway drawing.
