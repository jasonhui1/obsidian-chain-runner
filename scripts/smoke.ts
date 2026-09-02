/**
 * The engine half of the manual smoke in README.md, run against a live
 * maestro-playground rather than the fake. It exercises the same client the
 * plugin loads; the Obsidian half — the pill, the settings box, the notices —
 * still has to be looked at in a vault.
 *
 *   npx tsx scripts/smoke.ts [--url http://localhost:3000] [--run-id <id>] [--launch]
 *
 * `--launch` starts a real chain run, which spends real model tokens. Without
 * it the smoke is read-only.
 */
import { EngineClient } from '../src/engine/client'
import { createNodeTransport } from '../src/engine/nodeTransport'
import { EngineStatus } from '../src/engine/status'
import { isEvent } from '../src/engine/types'

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

const engineUrl = flag('url') ?? 'http://localhost:3000'
const runId = flag('run-id')
const launch = process.argv.includes('--launch')

const client = new EngineClient(() => engineUrl, createNodeTransport())

function report(step: string, detail: unknown): void {
  console.log(`  ${step}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
}

async function main(): Promise<void> {
  console.log(`smoke against ${engineUrl}`)

  const status = new EngineStatus(() => client.ping())
  report('ping', await status.refresh())
  if (!status.isOnline) {
    console.log('  engine offline — start maestro-playground and retry')
    process.exit(1)
  }

  const chains = await client.listChains()
  report('listChains', `${chains.length} chains`)
  for (const chain of chains.slice(0, 10)) {
    report(`  ${chain.slug}`, {
      name: chain.name,
      purpose: chain.purpose,
      moment: chain.moment,
      parameter: chain.parameter?.name,
    })
  }

  let inspect = runId
  if (launch) {
    const chain = chains[0]
    if (!chain) {
      console.log('  no chains in the workspace — nothing to run')
    } else {
      console.log(`  launchRun ${chain.name}`)
      const seen = new Map<string, number>()
      for await (const event of client.launchRun({
        chainName: chain.name,
        seedPrompt: 'A smoke test premise: standups are worth the time they cost.',
        paramValue: chain.parameter?.options[0],
      })) {
        seen.set(event.type, (seen.get(event.type) ?? 0) + 1)
        if (isEvent(event, 'run_complete')) inspect = event.runId
        if (isEvent(event, 'error')) report('    engine error', event.error)
      }
      report('  events', Object.fromEntries(seen))
    }
  }

  if (!inspect) {
    console.log('  no run id — pass --run-id <id> or --launch to check getRun/getLayout')
    return
  }
  const meta = await client.getRun(inspect)
  report('getRun', { runId: meta.runId, chain: meta.chainName, status: meta.status, outputs: meta.agentOutputs.length })
  const layout = await client.getLayout(inspect)
  report('getLayout', { kind: layout.kind, panels: layout.panels.map(panel => `${panel.name}:${panel.state}`) })
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
