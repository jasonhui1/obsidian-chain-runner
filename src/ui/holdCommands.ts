import { canonNote, isLanding, type Hold, type Holds, type Resumed, type TriggerKind } from './holds'
import type { RunResult } from '../run/session'

/** The palette commands on a hold: each finds its hold and hands it to the hold module, which does the rest. */

export const NOT_A_HOLD_NOTE = 'Open a hold note first'
export const NO_RUN_TO_DIRECT = 'No finished run to direct'

type Notify = (message: string) => void

export interface ConditionalHoldCommand {
  id: string
  name: string
  checkCallback: (checking: boolean) => boolean
}

/** "Direct this run": the run on screen written into its hold note, and opened. */
export async function directRun(holds: Holds, notify: Notify, result: RunResult | undefined): Promise<void> {
  if (!result?.runId || result.status === 'running') return notify(NO_RUN_TO_DIRECT)
  const hold = await holds.write(result.runId, result.chainName)
  if (!hold) return
  notify(`Wrote the hold note for run ${hold.runId}`)
  await holds.open(hold.runId)
}

/** "Resume this hold" on the note in front. */
export async function resumeFront(holds: Holds, notify: Notify): Promise<void> {
  const hold = await holds.front()
  if (!hold) return notify(NOT_A_HOLD_NOTE)
  const resumed = await holds.resume(hold.runId)
  if (resumed) notify(resumeNotice(resumed))
}

/** "Rerun downstream" on the note in front; the hold module says how it landed. */
export async function rerunDownstreamFront(holds: Holds, notify: Notify): Promise<void> {
  const hold = await holds.front()
  if (hold) await holds.rerun(hold.runId)
  else notify(NOT_A_HOLD_NOTE)
}

/** "Reroll candidates" on the note in front; the engine's last open hold is the one rerolled. */
export async function rerollCandidatesFront(holds: Holds, notify: Notify): Promise<void> {
  const hold = await holds.front()
  if (!hold) return notify(NOT_A_HOLD_NOTE)
  await holds.reroll(hold.runId, hold.holds.at(-1)?.nodeId)
}

/** Offers the palette command only when the engine's advertised capability is current. */
export function rerollCandidatesCommand(
  holds: Holds,
  notify: Notify,
  advertised: () => boolean,
): ConditionalHoldCommand {
  return {
    id: 'reroll-hold-candidates',
    name: 'Reroll hold candidates',
    checkCallback: checking => {
      if (!advertised()) return false
      if (!checking) void rerollCandidatesFront(holds, notify)
      return true
    },
  }
}

/** "Chat with proposer", "Ask the room" and "Side quest": the trigger line typed in the note in front, answered. */
export async function sendFront(holds: Holds, notify: Notify, kind: TriggerKind): Promise<void> {
  const hold = await holds.front()
  if (!hold) return notify(NOT_A_HOLD_NOTE)
  const answered = await holds.send(hold.runId, kind)
  const said = answered && !isLanding(answered) ? answeredNotice(answered, kind) : undefined
  if (said) notify(said)
}

/** What the last entry of `kind` got back; nothing when it is still unanswered, which a notice has already said. */
function answeredNotice(hold: Hold, kind: TriggerKind): string | undefined {
  const entry = hold.conversation.filter(one => one.kind === kind).at(-1)
  if (entry?.kind === 'chat') return entry.reply === undefined ? undefined : `${entry.name} replied`
  if (entry?.kind === 'room') return entry.answers.length === 0 ? undefined : `The room answered (${entry.answers.length})`
  return entry?.kind === 'quest' && entry.runId ? `Side quest ran as ${entry.runId}` : undefined
}

function resumeNotice({ hold, forked, error, canon }: Resumed): string {
  const as = forked ? `Resumed — forked as run ${hold.runId}` : `Resumed as run ${hold.runId}`
  if (error === undefined) return as
  const note = canonNote(canon)
  return `${as}, but it failed: ${error}${note ? ` (${note})` : ''}`
}
