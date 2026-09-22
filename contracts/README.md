# Engine ↔ Plugin Contracts

This directory publishes recorded, byte-level integration contract fixtures between the Maestro engine and client plugins (such as [`obsidian-chain-runner`](https://github.com/jasonhui1/obsidian-chain-runner)).

## Purpose

Multi-agent engine execution involves streaming Server-Sent Events (SSE), layout model projections, interactive pause/hold points, chat branch promotions, and continuation forks. TypeScript types capture field shapes, but they do not guarantee runtime behavior:
- The exact order of SSE frames (e.g. `layout` preceding `agent_start`).
- Terminal stream events (`run_complete`, `run_waiting`, or `error`).
- How partial outputs and hold candidate options appear on the wire.
- How reopened views (`GET /api/runs/:id/layout`) reflect completed or interrupted runs.

By committing deterministic, stubbed-model recordings of these scenarios, both repositories test against the exact same contract:
- The **engine** generates these fixtures from real routes and asserts in its test suite that emitted bytes and JSON bodies never drift unexpectedly.
- The **plugin** replays these recorded streams against its stream parser, state machines, and view renderers to prevent integration breaks before release.

## Directory Structure

```text
contracts/
  README.md            # This documentation
  manifest.json        # Manifest cataloging scenarios, routes, and file mappings
  capabilities.json    # Engine capability flags (from GET /api/workspace)
  fresh/               # Fresh multi-step run completing with timeline layout
    request.json       # POST /api/run request body
    response.json      # HTTP transport descriptor (status, headers, bodyFile pointer)
    stream.sse         # Verbatim text/event-stream UTF-8 payload
    run.json           # Post-run GET /api/runs/:id metadata
    layout.json        # Post-run GET /api/runs/:id/layout model
  hold/                # Run reaching a human-in-the-loop hold point
    request.json
    response.json
    stream.sse
    run.json
    layout.json
  resume/              # Resuming a held run with a chosen candidate and user direction
    request.json       # POST /api/runs/:id/resume request body
    response.json
    stream.sse
    run.json
    layout.json
  promote/             # Promoting a node chat reply to rerun downstream to the hold
    request.json       # POST /api/runs/:id/nodes/:nodeId/promote request body
    response.json
    stream.sse
    run.json
    layout.json
  reroll/              # Rerolling an open hold twice with saved feedback (#134)
    feedback-request.json  # PATCH /api/runs/:id/holds/:holdId body
    feedback-response.json # its JSON response
    request.json       # POST /api/runs/:id/holds/:holdId/reroll body (the second reroll)
    response.json
    stream.sse
    run.json
    layout.json
    refusal-request.json   # POST /api/runs/:id/resume with a stale revision
    refusal-response.json  # HTTP 409 JSON response body
  reroll-failed/       # A reroll answered without candidates: reroll_failed, then run_waiting with the kept set
    request.json
    response.json
    stream.sse
    run.json
    layout.json
  fork/                # Forking a completed run from an upstream anchor node
    request.json       # POST /api/runs/:id/fork request body
    response.json
    stream.sse
    run.json
    layout.json
  error/               # Terminal stream failure after persistence fault, plus HTTP refusal
    request.json       # POST /api/run request body
    response.json
    stream.sse
    run.json
    layout.json
    refusal-request.json   # POST /api/runs/:id/resume invalid body
    refusal-response.json  # HTTP 400 JSON response body
```

## Transport Descriptor (`response.json`)

Because successful run and continuation routes stream SSE over `Content-Type: text/event-stream`, `response.json` is **not** a wire HTTP response body. Instead, it is a fixture transport descriptor:
```json
{
  "status": 200,
  "headers": {
    "content-type": "text/event-stream"
  },
  "bodyFile": "stream.sse"
}
```
For non-streaming endpoints (such as the HTTP 400 Bad Request recorded in `error/refusal-response.json`), the file contains the exact JSON response body returned over the wire (e.g. `{"error": "..."}`). Its HTTP status (400) and headers are cataloged in `manifest.json`.

## How a Plugin Consumes Contracts

1. **Vendor the Fixtures**:
   Copy the `contracts/` directory from a pinned commit of this repository into the plugin's test fixture folder (e.g. `test/fixtures/contracts/`), recording the source commit hash.
2. **Replay SSE Streams**:
   Feed `stream.sse` directly into the plugin's stream parser across various byte chunk boundaries (simulating real-world chunking, split UTF-8 characters, and frame delimiters).
3. **Verify UI & State Transitions**:
   - Assert that the initial `layout` frame renders pending panels.
   - Assert that intermediate `agent_done` and `layout` frames update panel states to `filled`.
   - Assert that `run_waiting` properly activates the hold modal with the candidates in `hold`.
   - Assert that terminal `error` frames display the failure reason on failed panels.
4. **Reopening Views**:
   Use `run.json` and `layout.json` to verify how the plugin rehydrates notes and reopened run views.
5. **Feature Detection**:
   Use `capabilities.json` to verify client feature-detection branches without hardcoding engine version numbers.
   `varianceGroups` advertises `POST /api/variance`, `GET /api/variance/:groupId`, and the `varianceGroupId` run-list filter.
   `holdFeedback` advertises `PATCH /api/runs/:id/holds/:holdId`; `holdReroll` advertises `POST /api/runs/:id/holds/:holdId/reroll`, the `reroll_failed` event, and `revision` on hold records and resume bodies.

## Checking & Updating Contracts

The contract tests replay the committed fixtures offline as part of `npm test`; they do not fetch the engine or compare against a moving branch.

To deliberately refresh the fixtures, pass the full engine commit SHA to the updater:

```bash
npm run contracts:update -- <full commit SHA>
```

The updater fetches only that pinned commit and records it in `SOURCE.md`.
