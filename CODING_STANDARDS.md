# Coding Standards

Read by `/code-review`'s Standards axis. Each rule cites the ADR that ratified
it — the ADR carries context and rejected alternatives; this file carries only
the appliable rule.

## Comments
- If you need a paragraph-long comment to justify why the workaround is OK, the code is wrong - fix the code.

Keep them short. A comment earns one or two lines: what a module is for, or why
a line is not what it looks like. Not the argument behind it, not the options
rejected on the way — those go in an ADR, and the comment cites it.

No pure comment bloat:
1. Restatements — comments saying what the next line already does.
2. Narrated history — "was X, now Y", "promoted from Z", "used to read A".
3. Justification essays — long paragraphs justifying workarounds.
4. Length for its own sake — a correct comment three times longer than it needs
   to be is still bloat. Short and readable beats complete.

## Implementation
- prefer maintainable and scalable implementation solutions