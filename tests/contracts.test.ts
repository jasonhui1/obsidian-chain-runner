import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineClient } from '@/engine/client'
import { createNodeTransport } from '@/engine/nodeTransport'
import type { AgentOutput, Capabilities, ChainSummary, HoldRecord, LayoutModel, PromoteRequest, RunEvent, RunMeta, RunRequest, ResumeRequest } from '@/engine/types'
import { directionLines } from '@/run/holdNote'
import { promoteRequest, runPromote, UNSUPPORTED_PROMOTE } from '@/run/promote'
import { resumeRequest, runResume, UNSUPPORTED_RESUME } from '@/run/resume'
import { runFork, UNSUPPORTED_FORK } from '@/run/rerun'
import { applyRunEvent, buildRunResult, emptyRunState, settleRun, type RunResult } from '@/run/session'
import { streamsLayout, streamsOutputs, UNSUPPORTED_ENGINE } from '@/run/stream'
import { chatReply, UNSUPPORTED_CHAT } from '@/run/proposerChat'
import { QuickRunner } from '@/ui/quickRun'
import type { App } from 'obsidian'
import type { RunResultView } from '@/ui/resultView'
import type { VarianceView } from '@/ui/varianceView'
import { lastModal, resetModals } from './obsidian'
import { MemoryNoteStore } from './memoryNoteStore'

interface ContractScenario {
  request: { method: string; path: string; file: string }
  response: {
    status: number
    contentType: string
    descriptorFile: string
    streamFile: string
  }
  observations: { method: string; path: string; file: string; status: number; contentType: string }[]
}

interface ContractManifest {
  capabilities: string
  scenarios: Record<string, ContractScenario>
}

interface ContractHold extends HoldRecord {
  revision?: number
  feedback?: string
}

interface ContractRun extends RunMeta {
  holds?: ContractHold[]
}

interface ResponseDescriptor {
  status: number
  headers: { 'content-type': string }
  bodyFile: string
}

const CONTRACTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'contracts')
const SOURCE_SHA = '92b3b44058d879552c17472d0a9eab65ac9584c8'
const EXPECTED_SCENARIOS = ['fresh', 'hold', 'resume', 'promote', 'fork', 'error', 'reroll', 'reroll-failed']
const manifest = readContractJson<ContractManifest>('manifest.json')
const recordedCapabilities = readContractJson<Capabilities>(manifest.capabilities)
const scenarioNames = Object.keys(manifest.scenarios)

interface BytePlan {
  chunks: Buffer[]
  delayedBoundaries: Set<number>
  splitMultibyteCharacters: number
  splitFrameSeparators: number
}

interface ActiveResponse {
  status: number
  contentType: string
  bytes: Buffer
  plan: BytePlan
}

interface CapturedRequest {
  method: string
  path: string
  body: string
}

let server: Server
let engineUrl: string
let activeResponse: ActiveResponse | undefined
let workspace: { chains: ChainSummary[]; capabilities: Capabilities }
let capturedRequests: CapturedRequest[]

beforeAll(async () => {
  server = createServer((request, response) => {
    const body: Buffer[] = []
    request.on('data', (chunk: Buffer | string) => body.push(Buffer.from(chunk)))
    request.on('end', () => {
      capturedRequests.push({
        method: request.method ?? 'GET',
        path: request.url ?? '/',
        body: Buffer.concat(body).toString('utf8'),
      })

      if (request.method === 'GET' && request.url === '/api/workspace') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(workspace))
        return
      }

      if (!activeResponse) {
        response.writeHead(500, { 'content-type': 'text/plain' })
        response.end('No contract response selected')
        return
      }

      void writeContractStream(response, activeResponse).catch(error => {
        response.destroy(error instanceof Error ? error : new Error(String(error)))
      })
    })
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address() as AddressInfo
  engineUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close(error => (error ? rejectClose(error) : resolveClose()))
  })
})

beforeEach(() => {
  activeResponse = undefined
  workspace = { chains: [], capabilities: {} }
  capturedRequests = []
  resetModals()
})

describe('the pinned engine contract manifest', () => {
  it('records the verified upstream commit beside the vendored fixtures', () => {
    expect(readContractText('SOURCE.md')).toContain(SOURCE_SHA)
    expect(readContractText('SOURCE.md')).toContain('npm run contracts:update -- <full commit SHA>')
  })

  it('requires the eight recorded scenarios and capability fixture', () => {
    expect([...scenarioNames].sort()).toEqual([...EXPECTED_SCENARIOS].sort())
    expect(recordedCapabilities).toMatchObject({
      runLayoutFrames: true,
      runStartEvent: true,
      runFailureFrame: true,
      runFork: true,
      varianceGroups: true,
    })
  })

  it('keeps a recorded multibyte value available for byte-boundary replay', () => {
    const hasMultibyteStream = scenarioNames.some(name => {
      const bytes = Buffer.from(readContractText(manifest.scenarios[name].response.streamFile), 'utf8')
      return bytePlan(bytes).splitMultibyteCharacters > 0
    })
    expect(hasMultibyteStream).toBe(true)
  })

  it.each(scenarioNames)('replays %s through the engine transport, SSE parser, and run fold', async scenarioName => {
    const scenario = manifest.scenarios[scenarioName]
    const descriptor = readContractJson<ResponseDescriptor>(scenario.response.descriptorFile)
    const streamPath = scenario.response.streamFile
    const streamText = readContractText(streamPath)
    const streamBytes = Buffer.from(streamText, 'utf8')

    expect(descriptor.status).toBe(scenario.response.status)
    expect(descriptor.headers['content-type']).toBe(scenario.response.contentType)
    expect(descriptor.bodyFile).toBe(basename(streamPath))
    expect(scenario.request.method).toBe('POST')

    activeResponse = {
      status: scenario.response.status,
      contentType: scenario.response.contentType,
      bytes: streamBytes,
      plan: bytePlan(streamBytes),
    }
    const stringChunks: string[] = []
    const client = clientWithCodePointChunks(stringChunks)
    const events = await drain(client.launchRun({ chainName: 'contract replay', seedPrompt: 'recorded stream' }))

    expect(activeResponse.plan.splitFrameSeparators).toBeGreaterThan(0)
    expect(stringChunks.join('')).toBe(streamText)
    expect(frameSeparatorCrossesChunks(streamText, stringChunks)).toBe(true)
    expect(activeResponse.plan.splitMultibyteCharacters).toBe(countMultibyteLeads(streamBytes))
    expect(events.length).toBeGreaterThan(0)

    let state = emptyRunState()
    for (const event of events) state = applyRunEvent(state, event)

    const run = contractRun(scenarioName)
    const layout = contractLayout(scenarioName)
    const chain: ChainSummary = { slug: 'contract', name: run.chainName }
    const final = settleRun(state)
    const result = buildRunResult({ chain, seed: { note: 'fixture.md', from: 'note' }, state: final })
    const expectedTerminal = run.status === 'complete' ? 'run_complete' : run.status === 'waiting' ? 'run_waiting' : 'error'

    expect(final.runId).toBe(run.runId)
    const lastStreamLayout = events
      .filter((event): event is Extract<RunEvent, { type: 'layout' }> => event.type === 'layout')
      .at(-1)?.model
    expect(final.layout).toEqual(lastStreamLayout)
    const foldedOutputs = projectOutputs(state.nodes.outputs)
    if (scenarioName === 'error') {
      expect(layout.panels.every(panel => panel.state === 'pending')).toBe(true)
      expect(run.agentOutputs).toEqual([])
      expect(foldedOutputs).toEqual([
        {
          nodeId: 'proposer',
          status: 'success',
          output: 'Draft proposal ready\n\n## Summary\nDraft proposal summary',
        },
        {
          nodeId: 'decider',
          status: 'success',
          output: '## Candidate 1\nAlpha Option\n\n## Candidate 2\nBeta Option',
        },
      ])
      const errorPanels = [
        { name: 'proposal', node: 'proposer', text: 'Draft proposal summary', lines: 1, state: 'filled' },
        { name: 'verdict', node: 'decider', text: '', lines: 0, state: 'empty' },
        {
          name: 'after',
          node: 'after',
          text: '',
          lines: 0,
          state: 'errored',
          emphasis: 'last',
          error: 'Simulated persistence failure',
        },
      ]
      expect(final.layout).toEqual({ kind: 'timeline', panels: errorPanels })
      expect(result.layout).toEqual({ kind: 'timeline', panels: errorPanels })
      expect(result.layout).not.toEqual(layout)
    } else {
      const expectedRecordedOutputs = recordedStreamOutputs(scenarioName, run)
      expect(foldedOutputs).toEqual(projectOutputs(expectedRecordedOutputs))
      expect(final.layout).toEqual(layout)
      expect(result.layout).toEqual(layout)
    }
    expect(events.at(-1)?.type).toBe(expectedTerminal)
    const streamedHopFailed = state.nodes.outputs.some(output => output.status === 'error')
    expect(result.status).toBe(run.status === 'error' || streamedHopFailed ? 'failed' : 'done')
    expect(result.runId).toBe(run.runId)

    if (run.status === 'error') {
      expect(final.error).toBeDefined()
      expect(result.error).toBe(final.error)
    }

    const waiting = events.filter((event): event is Extract<RunEvent, { type: 'run_waiting' }> => event.type === 'run_waiting').at(-1)
    if (run.status === 'waiting') {
      expect(waiting).toBeDefined()
      const hold = run.holds?.find(candidate => candidate.nodeId === waiting?.nodeId)
      expect(hold).toBeDefined()
      expect(waiting?.hold).toMatchObject({
        nodeId: hold?.nodeId,
        revision: hold?.revision,
        candidates: hold?.candidates,
      })
    }

    if (scenarioName === 'resume') {
      const original = contractRun('hold').holds?.[0]
      const resumed = run.holds?.[0]
      const resumeBody = readContractJson<ResumeRequest>(scenario.request.file)
      expect(resumed).toMatchObject({
        revision: original?.revision,
        candidates: original?.candidates,
        chosen: resumeBody.chosen,
      })
    }

    if (scenarioName === 'reroll-failed') {
      const retained = run.holds?.[0]
      const original = contractRun('hold').holds?.[0]
      const failedFrame = events.find(event => event.type === 'reroll_failed')
      const failedOutput = run.agentOutputs.find(output => output.status === 'error')
      expect(failedFrame).toMatchObject({ type: 'reroll_failed', nodeId: retained?.nodeId })
      expect(retained).toMatchObject({
        revision: original?.revision,
        candidates: original?.candidates,
        feedback: 'Kinder still',
      })
      expect(waiting?.hold.candidates).toEqual(original?.candidates)
      expect(failedOutput).toMatchObject({
        status: 'error',
        reroll: { holdId: retained?.nodeId, feedback: 'Kinder still' },
      })
    }

    expect(capturedRequests.filter(request => request.method === 'POST')).toHaveLength(1)
  })
})

describe('recorded request builders', () => {
  it('builds the launch body through QuickRunner', async () => {
    const scenario = manifest.scenarios.fresh
    const expected = readContractJson<RunRequest>(scenario.request.file)
    activeResponse = responseFor('fresh')
    workspace = {
      capabilities: recordedCapabilities,
      chains: [{ slug: expected.chainName ?? '', name: expected.chainName ?? '' }],
    }

    const client = clientWithCodePointChunks([])
    const runner = makeQuickRunner(client)
    await runner.runOn(
      { text: expected.seedPrompt, from: 'note' },
      { name: 'fixture.md', path: 'fixture.md' },
    )
    expect(lastModal()?.placeholder).toBe('Run which chain on this note?')
    choose(0)
    expect(lastModal()?.placeholder).toBe('Choose how to start')
    choose(0)
    expect(lastModal()?.placeholder).toBe('Run how many times?')
    choose(0)
    await vi.waitFor(() => expect(capturedRequests.some(request => request.path === scenario.request.path)).toBe(true))

    const sent = capturedRequests.find(request => request.path === scenario.request.path)
    expect(sent?.method).toBe(scenario.request.method)
    expect(JSON.parse(sent?.body ?? '{}')).toEqual(expected)
  })

  it('builds the resume body from the recorded hold and posts the recorded shape', async () => {
    const scenario = manifest.scenarios.resume
    const expected = readContractJson<ResumeRequest>(scenario.request.file)
    const originalRun = contractRun('hold')
    const hold = originalRun.holds?.[0]
    if (!hold) throw new Error('The hold fixture has no hold to resume')

    const request = resumeRequest({
      direction: expected.direction,
      said: directionLines(expected.direction),
      holds: [{ nodeId: hold.nodeId, chosen: hold.candidates.find(candidate => candidate.heading === expected.chosen)?.heading }],
    })
    expect(request).toEqual(expected)

    await expectRecordedPost(
      'resume',
      scenario.request.path.replace(':id', encodeURIComponent(originalRun.runId)),
      expected,
      client => client.resumeRun(originalRun.runId, request),
    )
  })

  it('builds the promote body from the recorded turn and posts the recorded shape', async () => {
    const scenario = manifest.scenarios.promote
    const expected = readContractJson<PromoteRequest>(scenario.request.file)
    const originalRun = contractRun('hold')
    const nodeId = originalRun.agentOutputs.find(output => output.nodeId === 'proposer')?.nodeId
    if (!nodeId) throw new Error('The hold fixture has no proposer to promote')

    const request = promoteRequest({
      runId: originalRun.runId,
      nodeId,
      name: 'Proposer',
      ...(expected.turn !== undefined ? { turn: expected.turn } : {}),
    })
    expect(request).toEqual(expected)

    await expectRecordedPost(
      'promote',
      scenario.request.path
        .replace(':id', encodeURIComponent(originalRun.runId))
        .replace(':nodeId', encodeURIComponent(nodeId)),
      expected,
      client => client.promoteNode({ runId: originalRun.runId, nodeId }, request),
    )
  })
})

describe('recorded capabilities and unsupported routes', () => {
  it('uses the fixture flags to allow supported run surfaces', () => {
    expect(streamsLayout(recordedCapabilities)).toBe(true)
    expect(streamsOutputs(recordedCapabilities)).toBe(true)
    expect(recordedCapabilities.varianceGroups).toBe(true)
    expect(recordedCapabilities.runFork).toBe(true)
  })

  it.each([false, undefined])('does not open QuickRunner controls when runLayoutFrames is %s', async value => {
    workspace = {
      capabilities: { ...recordedCapabilities, runLayoutFrames: value },
      chains: [{ slug: 'fixture-chain', name: 'Fixture chain' }],
    }
    const notices: string[] = []
    const runner = makeQuickRunner(clientWithCodePointChunks([]), notices)
    await runner.runOn({ text: 'seed', from: 'note' }, { name: 'fixture.md', path: 'fixture.md' })

    expect(lastModal()).toBeUndefined()
    expect(notices).toEqual([UNSUPPORTED_ENGINE])
    expect(capturedRequests.filter(request => request.method === 'POST')).toEqual([])
  })

  it('requires each output-stream capability instead of inferring support', () => {
    expect(streamsOutputs({ ...recordedCapabilities, runStartEvent: undefined })).toBe(false)
    expect(streamsOutputs({ ...recordedCapabilities, runFailureFrame: false })).toBe(false)
    expect(streamsLayout({ ...recordedCapabilities, runLayoutFrames: undefined })).toBe(false)
  })

  it('does not open a route when a recorded route capability is false or explicitly required and absent', async () => {
    const cases = [
      { capability: 'runResume' as const, invoke: (engine: EngineClient) => runResume(engine, 'contract-run-hold', { direction: 'KEEP: Alpha Option' }), said: UNSUPPORTED_RESUME },
      { capability: 'nodePromote' as const, invoke: (engine: EngineClient) => runPromote(engine, { runId: 'contract-run-hold', nodeId: 'proposer', name: 'Proposer', turn: 1 }), said: UNSUPPORTED_PROMOTE },
      { capability: 'proposerChat' as const, invoke: (engine: EngineClient) => chatReply(engine, { runId: 'contract-run-hold', nodeId: 'proposer', name: 'Proposer', message: 'Why?' }), said: UNSUPPORTED_CHAT },
      { capability: 'runFork' as const, invoke: (engine: EngineClient) => runFork(engine, 'contract-run-hold', { revisions: { proposer: 'Edited' } }), said: UNSUPPORTED_FORK },
    ]

    for (const testCase of cases) {
      capturedRequests = []
      workspace = { chains: [], capabilities: { ...recordedCapabilities, [testCase.capability]: false } }
      const answer = await testCase.invoke(clientWithCodePointChunks([]))
      expect(answer).toMatchObject({ kind: 'refused', said: testCase.said, unsupported: true })
      expect(capturedRequests.filter(request => request.method === 'POST')).toEqual([])
    }

    capturedRequests = []
    const withoutFork: Capabilities = { ...recordedCapabilities }
    delete withoutFork.runFork
    workspace = { chains: [], capabilities: withoutFork }
    const answer = await runFork(clientWithCodePointChunks([]), 'contract-run-hold', { revisions: { proposer: 'Edited' } })
    expect(answer).toMatchObject({ kind: 'refused', said: UNSUPPORTED_FORK, unsupported: true })
    expect(capturedRequests.filter(request => request.method === 'POST')).toEqual([])
  })
})

function readContractJson<T>(path: string): T {
  return JSON.parse(readContractText(path)) as T
}

function readContractText(path: string): string {
  return readFileSync(join(CONTRACTS, path), 'utf8')
}

function observationFile(scenarioName: string, route: string): string {
  const observation = manifest.scenarios[scenarioName].observations.find(item => item.path === route)
  if (!observation) throw new Error(`${scenarioName} has no ${route} observation`)
  return observation.file
}

function contractRun(scenarioName: string): ContractRun {
  return readContractJson<ContractRun>(observationFile(scenarioName, '/api/runs/:id'))
}

function contractLayout(scenarioName: string): LayoutModel {
  return readContractJson<LayoutModel>(observationFile(scenarioName, '/api/runs/:id/layout'))
}

function projectOutputs(outputs: readonly AgentOutput[]) {
  return outputs.map(({ nodeId, status, output }) => ({ nodeId, status, output }))
}

function recordedStreamOutputs(scenarioName: string, run: ContractRun): AgentOutput[] {
  // Follow-up recordings retain earlier outputs; their stream carries this action's suffix.
  if (scenarioName === 'resume' || scenarioName === 'promote') {
    return run.agentOutputs.slice(contractRun('hold').agentOutputs.length)
  }
  if (scenarioName === 'reroll') return run.agentOutputs.slice(-1)
  if (scenarioName === 'reroll-failed') return run.agentOutputs.filter(output => output.status === 'error')
  return run.agentOutputs
}

function responseFor(name: string): ActiveResponse {
  const scenario = manifest.scenarios[name]
  const bytes = Buffer.from(readContractText(scenario.response.streamFile), 'utf8')
  return {
    status: scenario.response.status,
    contentType: scenario.response.contentType,
    bytes,
    plan: bytePlan(bytes),
  }
}

function bytePlan(bytes: Buffer): BytePlan {
  const boundaries = new Set<number>()
  const delayedBoundaries = new Set<number>()
  let splitMultibyteCharacters = 0
  let splitFrameSeparators = 0

  for (let index = 0; index < bytes.length - 1; index++) {
    const byte = bytes[index]
    if (byte >= 0xc2 && byte <= 0xf4) {
      boundaries.add(index + 1)
      delayedBoundaries.add(index + 1)
      splitMultibyteCharacters++
    }
    if (byte === 0x0a && (bytes[index + 1] === 0x0a || bytes[index + 1] === 0x0d)) {
      boundaries.add(index + 1)
      delayedBoundaries.add(index + 1)
      splitFrameSeparators++
    }
  }

  for (let boundary = 19; boundary < bytes.length; boundary += 19) boundaries.add(boundary)
  boundaries.add(bytes.length)

  const chunks: Buffer[] = []
  let start = 0
  for (const end of [...boundaries].sort((left, right) => left - right)) {
    if (end <= start) continue
    chunks.push(bytes.subarray(start, end))
    start = end
  }
  return { chunks, delayedBoundaries, splitMultibyteCharacters, splitFrameSeparators }
}

async function writeContractStream(response: ServerResponse, active: ActiveResponse): Promise<void> {
  response.writeHead(active.status, { 'content-type': active.contentType })
  response.socket?.setNoDelay(true)
  response.flushHeaders()

  let offset = 0
  for (const chunk of active.plan.chunks) {
    response.write(chunk)
    offset += chunk.length
    if (active.plan.delayedBoundaries.has(offset)) await new Promise(resolveDelay => setTimeout(resolveDelay, 1))
  }
  response.end()
}

function clientWithCodePointChunks(chunks: string[]): EngineClient {
  const transport = createNodeTransport()
  return new EngineClient(() => engineUrl, {
    send: request => transport.send(request),
    async open(request) {
      const stream = await transport.open(request)
      return { ...stream, body: splitCodePoints(stream.body, chunks) }
    },
  })
}

async function* splitCodePoints(source: AsyncIterable<string>, seen: string[]): AsyncGenerator<string> {
  for await (const chunk of source) {
    for (const point of Array.from(chunk)) {
      seen.push(point)
      yield point
    }
  }
}

async function drain(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const all: RunEvent[] = []
  for await (const event of events) all.push(event)
  return all
}

async function expectRecordedPost(
  scenarioName: string,
  expectedPath: string,
  expectedBody: object,
  send: (client: EngineClient) => AsyncIterable<RunEvent>,
): Promise<void> {
  activeResponse = responseFor(scenarioName)
  await drain(send(clientWithCodePointChunks([])))
  const sent = capturedRequests.filter(request => request.method === 'POST').at(-1)
  expect(sent?.path).toBe(expectedPath)
  expect(JSON.parse(sent?.body ?? '{}')).toEqual(expectedBody)
}

function countMultibyteLeads(bytes: Buffer): number {
  return [...bytes].filter(byte => byte >= 0xc2 && byte <= 0xf4).length
}

function frameSeparatorCrossesChunks(text: string, chunks: string[]): boolean {
  const separator = text.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n'
  const start = text.indexOf(separator)
  if (start < 0) return false

  let offset = 0
  let pieces = 0
  for (const chunk of chunks) {
    if (offset < start + separator.length && offset + chunk.length > start) pieces++
    offset += chunk.length
  }
  return pieces > 1
}

function makeQuickRunner(engine: EngineClient, notices: string[] = [], shown: RunResult[] = []): QuickRunner {
  return new QuickRunner({
    app: {} as App,
    store: new MemoryNoteStore({}),
    engine,
    withEngine: action => action(),
    openResultView: async () => ({ show: (result: RunResult) => shown.push(result) }) as unknown as RunResultView,
    openVarianceView: async () => ({ showProgress: () => {}, showGroup: () => {}, showFailure: () => {} }) as unknown as VarianceView,
    notify: message => notices.push(message),
    markOffline: () => {},
    holdReached: async () => {},
  })
}

function choose(index: number): void {
  const modal = lastModal()
  if (!modal) throw new Error('No picker is open')
  modal.choose(index)
}
