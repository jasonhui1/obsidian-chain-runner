import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, normaliseEngineUrl, withDefaults } from '@/settings'

describe('normaliseEngineUrl', () => {
  it('keeps a well-formed URL as it is', () => {
    expect(normaliseEngineUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('drops surrounding whitespace and a trailing slash', () => {
    expect(normaliseEngineUrl('  http://localhost:3000/  ')).toBe('http://localhost:3000')
  })

  it('falls back to the default when the box is emptied', () => {
    expect(normaliseEngineUrl('   ')).toBe(DEFAULT_SETTINGS.engineUrl)
  })

  it('assumes http for a host typed without a scheme', () => {
    expect(normaliseEngineUrl('localhost:3000')).toBe('http://localhost:3000')
  })

  it('leaves text that is not a URL alone, so the box shows what was typed', () => {
    expect(normaliseEngineUrl('not a url')).toBe('not a url')
  })
})

describe('withDefaults', () => {
  it('fills in an unsaved setting', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_SETTINGS)
    expect(withDefaults({})).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps a saved setting', () => {
    expect(withDefaults({ engineUrl: 'http://127.0.0.1:4000' })).toEqual({ engineUrl: 'http://127.0.0.1:4000' })
  })

  it('ignores a saved value of the wrong type', () => {
    expect(withDefaults({ engineUrl: 42 })).toEqual(DEFAULT_SETTINGS)
  })
})
