# ADR-0006: Motion marks what is still happening, and nothing else

Date: 2026-09-04 · Status: accepted

## Context

#13 asked for "motion on state changes" across the plugin's surfaces. The
obvious reading is a one-shot cue where a state changes: a panel flashing as it
lands filled, the run's status word transitioning as it settles `done`.

Neither is reachable from the result view as it is built. `RunResultView.draw()
calls `contentEl.empty()` and rebuilds every element from scratch on every draw,
which has two consequences:

- **A CSS transition on run state never fires.** The property did not change on
  an element — the element was replaced. Only `:hover` and `:focus-visible`
  transition, because those happen on an element that stays put between states.
- **A one-shot keyframe re-fires on the next draw.** The view redraws for a
  round click and for every later hop landing, so a panel's arrival animation
  would replay long after the arrival. That reads as a flicker, not as a cue.

A keyed diff — holding panel elements across draws and updating the ones that
changed — removes both, and is worth having for the streaming redraw cost alone.
It is logged as #16. This ADR is about what to ship in the meantime, and it is
not "a one-shot cue with a known flicker".

A second question was settled and rejected: a spinner for a hop that is
streaming. A sidebar of one-per-panel spinners is busier than the words the
reader came for, and the panel already says `writing…` in its own notice.

## Decision

**Motion is reserved for state that is still in flight, and expressed as an
infinite pulse.** Six things qualify: the `running` run status, a `writing…`
panel notice, the status pill before its first check has answered, the result
view's *Waiting for the first hop*, and the directing panel's line for a rerun
that is going (`⟳ … is writing a new verdict… 0:42`, #44), and the same line
on a drawing's card that rerun is writing again (#45). Each breathes on `chain-runner-breathe`, whose restart on a redraw is invisible
precisely because it loops.

**Hover and focus transition**, since those are the only state changes that
happen to an element that survives them.

**No one-shot motion ships until the view stops rebuilding** (#16) — the hold
ADR-0007 lifts.

The pulse's own 1.6s period is a literal: Obsidian's `--anim-duration-*` scale
tops out well below a breath, and stretching one of those variables to fit would
be borrowing a name rather than a value. Every transition duration and easing
*is* Obsidian's, with a fallback so a theme that has dropped the variable loses
the motion rather than the rule.

## Consequences

**`prefers-reduced-motion: reduce` is one rule, not a list.** Because the policy
is "motion only ever marks in-flight state", the reduced-motion block can kill
transitions and animations across everything the plugin styles without deciding
anything case by case — and whatever is added later is covered by default.

**A reader loses nothing by turning motion off.** Every pulsing thing also says
what it is in words: `running`, `writing…`, the pill's `…`, *Waiting for the
first hop*, and the rerun line's step (and, in the panel, its timer). Motion is a
second channel here, never the only one — which is also what makes it safe for a
reader who cannot perceive it.
