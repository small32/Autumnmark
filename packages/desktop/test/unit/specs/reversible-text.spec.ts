import { describe, expect, it } from 'vitest'
import { reverseTextChange } from '@shared/reversibleText'

describe('reversing an AI edit', () => {
  it('retains later additions before, between, and after the edited ranges', () => {
    const before = 'red\nsecond line\nblue\n'
    const after = 'green\nsecond line\nyellow\n'
    const current = 'heading\ngreen\nupdated second line\nyellow\nfooter\n'
    expect(reverseTextChange(current, before, after)).toBe('heading\nred\nupdated second line\nblue\nfooter\n')
  })

  it('refuses to overwrite a later change inside the same range', () => {
    expect(reverseTextChange('greener\n', 'red\n', 'green\n')).toBe('reder\n')
    expect(reverseTextChange('grain\n', 'red\n', 'green\n')).toBeNull()
  })
})
