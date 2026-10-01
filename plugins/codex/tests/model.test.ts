import { describe, expect, test } from 'claude-code/testing'

import { modelOf } from '../hooks/model'

describe('modelOf', () => {
  test('reads the top-level model and effort', () => {
    expect(modelOf('model = "gpt-5"\nmodel_reasoning_effort = "high"\n')).toBe('gpt-5 (high)')
  })

  test('ignores keys inside tables', () => {
    expect(modelOf('[profiles.fast]\nmodel = "gpt-5-mini"\n')).toBeUndefined()
  })

  test('a config without a model names none', () => {
    expect(modelOf('approval_policy = "never"\n')).toBeUndefined()
  })
})
