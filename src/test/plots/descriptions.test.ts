import { describe, expect, it } from 'vitest'
import { clip, describer, globToRegex } from '../../lib/plots/descriptions'

describe('metric descriptions', () => {
  it('matches globs by path segment', () => {
    expect(globToRegex('*/loss/ce').test('train/loss/ce')).toBe(true)
    expect(globToRegex('*/loss/ce').test('a/b/loss/ce')).toBe(false)
    expect(globToRegex('val/**').test('val/loss/ce')).toBe(true)
    expect(globToRegex('val/**').test('train/loss')).toBe(false)
    expect(globToRegex('**/ce').test('val/loss/ce')).toBe(true)
    expect(globToRegex('train/loss_*').test('train/loss_bits')).toBe(true)
    expect(globToRegex('train/loss.ce').test('train/lossxce')).toBe(false)
  })

  it('picks the most specific pattern', () => {
    const describe_ = describer({
      'val/**': 'Held out.',
      '*/loss/ce': 'Cross entropy on that split.',
      'val/loss/ce': 'Validation cross entropy.',
      '**': 'Anything.',
    })
    expect(describe_('val/loss/ce')).toBe('Validation cross entropy.')
    expect(describe_('train/loss/ce')).toBe('Cross entropy on that split.')
    expect(describe_('val/acc/top1')).toBe('Held out.')
    expect(describe_('lr')).toBe('Anything.')
    expect(describer({})('val/loss')).toBeNull()
  })

  it('keeps descriptions short and plain', () => {
    expect(clip('  two\n lines  ')).toBe('two lines')
    const long = clip('word '.repeat(100))
    expect(long.length).toBeLessThanOrEqual(240)
    expect(long.endsWith('…')).toBe(true)
  })
})
