import { describe, it, expect } from 'vitest'
import { parameterToAsk } from '@/engine/types'
import type { ChainSummary } from '@/engine/types'

const chain = (parameter?: ChainSummary['parameter']): ChainSummary => ({
  slug: 'relay',
  name: 'Telephone Relay',
  ...(parameter ? { parameter } : {}),
})

describe('parameterToAsk', () => {
  it('asks for the dropdown a chain declares, since the chain reads it as an input', () => {
    expect(parameterToAsk(chain({ name: 'lens', options: ['sceptic', 'builder'] }))).toEqual({
      name: 'lens',
      options: ['sceptic', 'builder'],
    })
  })

  it('asks for nothing when the chain declares no parameter, so the run starts on the pick', () => {
    expect(parameterToAsk(chain())).toBeUndefined()
  })

  it('asks for nothing when the dropdown has no options — there is no value to pick', () => {
    expect(parameterToAsk(chain({ name: 'lens', options: [] }))).toBeUndefined()
  })
})
