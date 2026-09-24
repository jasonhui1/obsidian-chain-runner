import type { RunMeta } from '../engine/types'

export const NAME_SEPARATOR = ' · '

export interface RunGroupPosition { index: number; count: number }

export interface RunNaming {
  chainName: string
  candidate?: string
  dropdownValue?: string
  group?: RunGroupPosition
  startTime?: Date | string | number
}

export function formatTime(time: Date | string | number): string {
  if (typeof time === 'string') {
    if (/^\d{2}:\d{2}$/.test(time)) return time
  }
  const date = typeof time === 'string' || typeof time === 'number' ? new Date(time) : time
  if (!Number.isNaN(date.getTime())) {
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${hours}:${minutes}`
  }
  return 'time unknown'
}

/** A repeated group appends its position when a higher-priority choice would otherwise repeat. */
export function runDifferentiator(naming: Omit<RunNaming, 'chainName'>): string {
  const group = naming.group && naming.group.count > 1
    ? `run ${naming.group.index + 1} of ${naming.group.count}`
    : undefined
  const choice = naming.candidate || naming.dropdownValue
  if (choice) return group ? `${choice} (${group})` : choice
  if (group) return group
  return naming.startTime === undefined ? 'time unknown' : formatTime(naming.startTime)
}

export function runName(naming: RunNaming): string {
  return `${naming.chainName}${NAME_SEPARATOR}${runDifferentiator(naming)}`
}

export function runNameFromMeta(meta: RunMeta, over?: Partial<RunNaming>): string {
  const chosen = meta.holds?.find(h => h.nodeId === meta.branchedFromNode)?.chosen
    ?? [...(meta.holds ?? [])].reverse().find(h => Boolean(h.chosen))?.chosen
  return runName({
    chainName: meta.chainName,
    candidate: chosen,
    dropdownValue: meta.parameter?.value,
    group: meta.variance ? { index: meta.variance.index, count: meta.variance.size } : undefined,
    startTime: meta.startedAt,
    ...over,
  })
}
