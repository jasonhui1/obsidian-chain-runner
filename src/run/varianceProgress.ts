export type VarianceMemberStatus = 'queued' | 'running' | 'complete' | 'waiting' | 'failed'

export interface VarianceMemberProgress {
  instance: number
  status: VarianceMemberStatus
  runId?: string
  currentNode?: string
  outputCount: number
}

export interface VarianceProgress {
  chainName: string
  expectedRunCount: number
  members: VarianceMemberProgress[]
}
