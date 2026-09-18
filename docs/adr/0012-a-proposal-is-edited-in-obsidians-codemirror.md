# ADR-0012: A proposal is edited in Obsidian's CodeMirror

Date: 2026-09-16 · Status: accepted

## Context

#38 gave the directing panel an **✎ Edit** that turned a proposal into a
textarea. A proposal is markdown, so editing it dropped its look: headings became
plain text, bold and italic became `**` and `*`. Editing a note in Obsidian keeps
the look while leaving the markdown in view, and that is what the panel was
asked for (#43).

The panel also redraws itself on every change to the hold — `DirectingBoard.draw`
empties its root and builds the elements again. A textarea's words survived that
because the board held them as a string and put them back; a cursor, a selection
and an undo history have no such string.

## Decision

**CodeMirror 6, and the copy Obsidian already loaded.** Obsidian hands plugins
its own modules through a registry keyed by package name — `obsidian`,
`@codemirror/{autocomplete,collab,commands,language,lint,search,state,text,view}`
and `@lezer/{common,lr,highlight}` (read out of `obsidian.asar`, Obsidian 1.13.1;
`obsidian` 1.13.1 also names `@codemirror/state` 6.5.0 and `@codemirror/view`
6.38.6 as peers). All of those are external in `esbuild.config.mjs`, so only
`@codemirror/lang-markdown` and `@lezer/markdown` are ours to bundle. A second
copy of `@codemirror/state` makes every `Facet` a different `Facet` and the
editor refuses to start, with a message that does not say so.

**The editor is a live object the panel keeps, not markup it draws.**
`src/ui/proposalEditor.ts` answers a `ProposalEditor` — an element, its words,
its focus, and how to let go of it. `DirectingBoard` holds one per proposal being
edited, in a frame kept by key for as long as the edit is open (ADR-0007, #61),
so the element is never moved and text, cursor, selection, focus and undo
history are never rebuilt.

**What each mark looks like lives in `styles.css`, not in the extension.** The
highlight style names classes (`chain-runner-md-h1`, `chain-runner-md-mark`) and
the stylesheet dresses them from Obsidian's own theme variables, so the reader's
theme and their snippets reach the editor. Markers stay in view, as in Obsidian's
editor: `##` takes both the heading class and the marker class, which is why the
marker rules are written as compound selectors.

## Rejected

**Obsidian's own Live Preview editor, embedded.** It is the real thing, and it
would also fade `##` off the cursor's line — but it is reached through private
internals that an Obsidian update can take away.

**Editing the hold note in a tab.** The real editor with none of the work, but it
leaves the panel, which #35 set out to avoid.

**Bundling all of CodeMirror.** It builds, and it would even run, since our
editor shares no state with Obsidian's. It also ships a second copy of everything
and leaves the `@codemirror/state` trap one careless import away.

## Consequences

**The plugin now depends on Obsidian's CodeMirror versions.** An Obsidian that
moved its registry, or moved far enough from `@codemirror/lang-markdown`'s
expectations, breaks the editor rather than the build. `package.json` pins
`@codemirror/state` and `@codemirror/view` to the versions Obsidian names, and
`overrides` keeps the dev tree to one copy of each so the tests run against what
ships.

**The bundle carries a markdown parser.** `@codemirror/lang-markdown` pulls the
HTML, CSS and JavaScript languages in for fenced code, which is most of the
plugin's size.

**An open editor outlives a tab switch and a run switch, and is let go of when
the panel closes.** `DirectingBoard.close` destroys every open editor; without it
a detached `EditorView` keeps its observers.

**Enter is the editor's, not the panel's.** The typing boxes send on Enter; a
proposal runs to many lines, so the editor keeps it. Nothing on the panel binds a
key inside the editor.
