# Coding Standards

Read by `/code-review`'s Standards axis. Each rule cites the ADR that ratified
it — the ADR carries context and rejected alternatives; this file carries only
the appliable rule.

## Comments
- If you need a paragraph-long comment to justify why the workaround is OK, the code is wrong - fix the code.

No pure comment bloat:
1. Restatements — comments saying what the next line already does.
2. Narrated history — "was X, now Y", "promoted from Z", "used to read A".
3. Justification essays — long paragraphs justifying workarounds.

## Implementation
- prefer maintainable and scalable implementation solutions