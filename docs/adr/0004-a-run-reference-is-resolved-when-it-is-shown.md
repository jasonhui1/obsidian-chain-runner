# ADR-0004: A run reference is resolved when it is shown

Date: 2026-09-03 · Status: accepted

## Context

An output note is filed under the run that wrote it (ADR-0003) and stamped with
`run:`, `chain:` and `output:`. #10 asks for more: the note should carry a link
back to the run on the engine, shown in the embeddable's header, and a run the
engine no longer has should read `source run deleted` rather than failing.

A link is a URL, and the engine's address is a setting. Baking it into the note
means a reader who moves the engine — a different port, a machine on the network
— has a vault full of notes pointing at nowhere, with no way back but a
find-and-replace across every run folder. Nor can a static link know that the run
behind it is gone: the words in the file cannot change when the engine's history
is cleared.

## Decision

**The note stores the run id; the header resolves the link when it renders.**

1. Frontmatter keeps `run:`, and gains `source:` — the URL as it stood when the
   note was written. That key is for readers outside this plugin (the properties
   panel, a search, another tool); nothing in the plugin reads it back.
2. A markdown post-processor puts one line above every rendering of an output
   note — an embeddable on a drawing and the note's own tab alike — built from
   `run:` and the engine URL set *now*.
3. That line asks the engine whether the run is still there. `missing` — the
   engine answered and has no such run — reads `source run deleted`. Anything
   else stays a link: an engine that cannot be reached is not a deleted run.

The line is drawn first and corrected when the answer arrives, and the answer is
remembered per run, because a note is re-rendered on every write of the run that
is still filling it.

## Consequences

**Moving the engine costs nothing.** Every header follows the setting. The stale
URL in `source:` is the only thing left pointing at the old address, and it is
not what the plugin reads.

**The provenance line is not in the note's text.** It is rendered, not stored, so
an output note fed back into another chain node seeds that run with the hop's own
words — the frontmatter comes off in `seedFromNote`, and there is nothing else to
strip. A stored header line would have to be stripped by a rule of its own, and
would arrive in any tool that read the file.

**Offline reads as a live link.** A reader clicking it while the engine is down
gets their browser's error, not ours. Saying `source run deleted` there would be
a lie the plugin is not entitled to tell.
