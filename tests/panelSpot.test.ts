import { describe, it, expect } from 'vitest'
import { PANEL, panelSpot } from '@/ui/panelSpot'

/**
 * Where a picker opens when it opens beside what it changes. Pure, so the
 * flipping and clamping are checked without a screen (ADR-0010).
 */

const viewport = { width: 1200, height: 800 }
const panel = { width: 300, height: 200 }

describe('panelSpot', () => {
  it('sits below and right of the click, clear of the pointer', () => {
    expect(panelSpot({ x: 100, y: 100 }, panel, viewport)).toEqual({ left: 112, top: 112 })
  })

  it('flips to the left when it would run off the right edge', () => {
    expect(panelSpot({ x: 1150, y: 100 }, panel, viewport).left).toBe(1150 - 12 - 300)
  })

  it('flips above when it would run off the bottom edge', () => {
    expect(panelSpot({ x: 100, y: 760 }, panel, viewport).top).toBe(760 - 12 - 200)
  })

  it('stays on screen when neither side fits', () => {
    const spot = panelSpot({ x: 5, y: 5 }, { width: 1190, height: 790 }, viewport)
    expect(spot).toEqual({ left: 8, top: 8 })
  })

  it('never goes off the top or left when the click is at the origin', () => {
    const spot = panelSpot({ x: 0, y: 0 }, panel, viewport)
    expect(spot.left).toBeGreaterThanOrEqual(8)
    expect(spot.top).toBeGreaterThanOrEqual(8)
  })

  it('declares the size it positions, so nothing has to measure a modal mid-open', () => {
    expect(PANEL.width).toBeGreaterThan(0)
    expect(PANEL.height).toBeGreaterThan(0)
  })
})
