import { describe, it, expect } from 'vitest'
import { buildWindowTitle } from '@/components/titleBar/windowTitle'

describe('buildWindowTitle', () => {
  it('shows the file and application names', () => {
    expect(buildWindowTitle('notes.md')).toBe('notes.md - AutumnMark+')
    expect(buildWindowTitle()).toBe('AutumnMark+')
  })
})
