import type { RunMeta, VarianceGroup, VarianceNode, VarianceSample } from '../engine/types'
import type { VarianceProgress } from '../run/varianceProgress'

export interface VarianceBoardDeps {
  openGroup: (groupId: string) => void
}

type BoardState =
  | { kind: 'idle' }
  | { kind: 'progress'; progress: VarianceProgress }
  | { kind: 'failure'; message: string }
  | { kind: 'group'; group: VarianceGroup }
  | { kind: 'member'; run: RunMeta; group: VarianceGroup }

/** The variance view's content, including the two full sample outputs. */
export class VarianceBoard {
  private state: BoardState = { kind: 'idle' }
  private nodeId: string | undefined
  private firstRunId: string | undefined
  private secondRunId: string | undefined

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: VarianceBoardDeps,
  ) {}

  showProgress(progress: VarianceProgress): void {
    this.state = { kind: 'progress', progress }
    this.draw()
  }

  showFailure(message: string): void {
    this.state = { kind: 'failure', message }
    this.draw()
  }

  showGroup(group: VarianceGroup): void {
    if (this.state.kind !== 'group' || this.state.group.groupId !== group.groupId) {
      this.nodeId = group.nodes[0]?.nodeId
      this.firstRunId = undefined
      this.secondRunId = undefined
    }
    this.state = { kind: 'group', group }
    this.draw()
  }

  private draw(): void {
    this.root.className = 'chain-runner-variance'
    this.root.replaceChildren()
    if (this.state.kind === 'progress') this.drawProgress(this.state.progress)
    else if (this.state.kind === 'failure') this.add('p', 'chain-runner-variance-failure', this.state.message)
    else if (this.state.kind === 'group') this.drawGroup(this.state.group)
    else if (this.state.kind === 'member') this.drawMember(this.state.run, this.state.group)
  }

  private drawProgress(progress: VarianceProgress): void {
    this.add('h2', 'chain-runner-variance-title', progress.chainName)
    this.add('p', 'chain-runner-variance-completion', `Running ${progress.expectedRunCount} times`)
    const list = this.add('ol', 'chain-runner-variance-members')
    for (const member of progress.members) {
      const label = [`Run ${member.instance + 1}`, member.runId, member.status, member.currentNode, member.outputCount ? `${member.outputCount} outputs` : undefined]
        .filter(Boolean)
        .join(' · ')
      this.add('li', 'chain-runner-variance-member', label, list)
    }
  }

  private drawGroup(group: VarianceGroup): void {
    this.add('h2', 'chain-runner-variance-title', group.chainName)
    this.add('p', 'chain-runner-variance-completion', `${group.completedRunCount} of ${group.expectedRunCount} runs completed`)
    if (group.costWarning) this.add('p', 'chain-runner-variance-cost chain-runner-variance-cost--warning', group.costWarning)
    else if (group.costUsd !== undefined) this.add('p', 'chain-runner-variance-cost', `Group cost: ${usd(group.costUsd)}`)
    else this.add('p', 'chain-runner-variance-cost chain-runner-variance-cost--unavailable', 'Group cost unavailable')

    this.add('h3', 'chain-runner-variance-section-title', 'Nodes')
    const nodes = this.add('div', 'chain-runner-variance-nodes')
    for (const node of group.nodes) {
      const button = this.add('button', 'chain-runner-variance-node', nodeLabel(node), nodes) as HTMLButtonElement
      button.type = 'button'
      button.dataset['nodeId'] = node.nodeId
      button.setAttribute('aria-pressed', String(node.nodeId === this.nodeId))
      button.addEventListener('click', () => {
        this.nodeId = node.nodeId
        this.firstRunId = undefined
        this.secondRunId = undefined
        this.state = { kind: 'group', group }
        this.draw()
      })
    }

    const active = group.nodes.find(node => node.nodeId === this.nodeId) ?? group.nodes[0]
    if (active) this.drawComparison(active)
    this.drawMembers(group)
  }

  private drawComparison(node: VarianceNode): void {
    const successful = node.samples.filter(sample => sample.status === 'success')
    this.add('h3', 'chain-runner-variance-section-title', `Compare ${node.nodeName}`)
    if (successful.length < 2) {
      this.add('p', 'chain-runner-variance-unavailable', `Two successful samples are not available (${node.successfulSampleCount}/${node.expectedSampleCount}).`)
      return
    }

    const first = this.sampleById(successful, this.firstRunId) ?? successful[0]!
    const second = successful.find(sample => sample.runId === this.secondRunId && sample.runId !== first.runId)
      ?? successful.find(sample => sample.runId !== first.runId)!
    this.firstRunId = first.runId
    this.secondRunId = second.runId

    const choices = this.add('div', 'chain-runner-variance-choices')
    this.samplePicker(choices, 'First run', successful, first, sample => {
      this.firstRunId = sample.runId
      if (this.secondRunId === sample.runId) this.secondRunId = successful.find(other => other.runId !== sample.runId)?.runId
      this.state = { kind: 'group', group: this.currentGroup() }
      this.draw()
    })
    this.samplePicker(choices, 'Second run', successful, second, sample => {
      this.secondRunId = sample.runId
      if (this.firstRunId === sample.runId) this.firstRunId = successful.find(other => other.runId !== sample.runId)?.runId
      this.state = { kind: 'group', group: this.currentGroup() }
      this.draw()
    })

    const comparison = this.add('div', 'chain-runner-variance-comparison')
    this.drawSample(first, 'left', comparison)
    this.drawSample(second, 'right', comparison)
  }

  private samplePicker(
    parent: HTMLElement,
    label: string,
    samples: VarianceSample[],
    selected: VarianceSample,
    onPick: (sample: VarianceSample) => void,
  ): void {
    const field = this.add('label', 'chain-runner-variance-choice', label, parent)
    const select = this.add('select', '', undefined, field) as HTMLSelectElement
    select.setAttribute('aria-label', label)
    for (const sample of samples) {
      const option = this.add('option', '', `Run ${sample.runIndex + 1} · ${sample.runId}`, select) as HTMLOptionElement
      option.value = sample.runId
      option.selected = sample.runId === selected.runId
    }
    select.addEventListener('change', () => {
      const sample = samples.find(candidate => candidate.runId === select.value)
      if (sample) onPick(sample)
    })
  }

  private drawSample(sample: VarianceSample, side: 'left' | 'right', parent: HTMLElement): void {
    const article = this.add('article', 'chain-runner-variance-sample', undefined, parent)
    this.add('h4', 'chain-runner-variance-sample-title', `Run ${sample.runIndex + 1} · ${sample.runId}`, article)
    const output = this.add('pre', `chain-runner-variance-output chain-runner-variance-output--${side}`, sample.output, article)
    output.setAttribute('aria-label', `${side === 'left' ? 'First' : 'Second'} run output`)
  }

  private drawMembers(group: VarianceGroup): void {
    this.add('h3', 'chain-runner-variance-section-title', 'Member runs')
    const list = this.add('ul', 'chain-runner-variance-members')
    for (const [index, run] of group.runs.entries()) {
      const item = this.add('li', 'chain-runner-variance-member', undefined, list)
      const button = this.add('button', 'chain-runner-variance-member-open', `Open run ${run.variance?.index !== undefined ? run.variance.index + 1 : index + 1} · ${run.runId}`, item) as HTMLButtonElement
      button.type = 'button'
      button.dataset['memberRun'] = run.runId
      button.addEventListener('click', () => {
        this.state = { kind: 'member', run, group }
        this.draw()
      })
    }
  }

  private drawMember(run: RunMeta, group: VarianceGroup): void {
    this.add('h2', 'chain-runner-variance-title', `Run ${run.variance ? run.variance.index + 1 : ''} · ${run.runId}`)
    const marker = run.variance
    if (marker?.groupId) {
      const button = this.add('button', 'chain-runner-variance-open-group', 'Open variance group') as HTMLButtonElement
      button.type = 'button'
      button.dataset['openVarianceGroup'] = marker.groupId
      button.addEventListener('click', () => this.deps.openGroup(marker.groupId))
    }
    const back = this.add('button', 'chain-runner-variance-back', 'Back to group') as HTMLButtonElement
    back.type = 'button'
    back.addEventListener('click', () => this.showGroup(group))
    for (const output of run.agentOutputs) {
      const section = this.add('section', 'chain-runner-variance-member-output')
      this.add('h3', 'chain-runner-variance-section-title', output.agentName, section)
      this.add('pre', 'chain-runner-variance-output', output.output, section)
      if (output.status !== 'success') this.add('p', 'chain-runner-variance-unavailable', output.error ?? output.status, section)
    }
  }

  private currentGroup(): VarianceGroup {
    if (this.state.kind !== 'group') throw new Error('variance comparison lost its group')
    return this.state.group
  }

  private sampleById(samples: VarianceSample[], runId: string | undefined): VarianceSample | undefined {
    return runId === undefined ? undefined : samples.find(sample => sample.runId === runId)
  }

  private add<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string, parent = this.root): HTMLElementTagNameMap[K] {
    const element = parent.ownerDocument.createElement(tag)
    if (cls) element.className = cls
    if (text !== undefined) element.textContent = text
    parent.append(element)
    return element
  }
}

function nodeLabel(node: VarianceNode): string {
  const spread = node.spread === undefined
    ? `Spread unavailable · ${node.successfulSampleCount}/${node.expectedSampleCount} successful`
    : `Spread ${node.spread}`
  return `${node.nodeName} · ${spread}`
}

function usd(amount: number): string {
  if (amount === 0) return '$0.00'
  return `$${Math.abs(amount) < 0.01 ? amount.toPrecision(3) : amount.toFixed(2)}`
}
