import { describe, expect, test } from 'claude-code/testing'

import { configOf, labelOf, modelsOf } from '../hooks/model'
import { optionsOf, overridesOf } from '../hooks/options'

describe('model', () => {
  test('reads the top-level model and effort, not a profile', () => {
    expect(configOf('model = "gpt-5"\nmodel_reasoning_effort = "high"\n[profiles.fast]\nmodel = "mini"\n')).toEqual({
      model: 'gpt-5',
      effort: 'high',
    })
  })

  test('the prompt choice wins over the config', () => {
    expect(labelOf({ model: 'gpt-5', effort: 'high' }, { model: 'gpt-6' })).toBe('gpt-6 (high)')
    expect(labelOf({}, {})).toBe('default model')
  })

  test('lists model ids from the cache and tolerates a missing one', () => {
    expect(modelsOf('{"models":[{"slug":"a"},{"slug":"b"}]}')).toEqual(['a', 'b'])
    expect(modelsOf('')).toEqual([])
  })
})

describe('options', () => {
  test('leading model and effort lines choose and are dropped from the task', () => {
    expect(optionsOf('model: gpt-6-astra\neffort: high\nReview app.js')).toEqual({
      model: 'gpt-6-astra',
      effort: 'high',
      prompt: 'Review app.js',
    })
  })

  test('a prompt without them is passed as is', () => {
    expect(optionsOf('Review app.js\nmodel: x')).toEqual({ prompt: 'Review app.js\nmodel: x' })
  })

  test('a value that could break out of the override is not an option', () => {
    expect(optionsOf('model: a" -c x="y\nReview').model).toBeUndefined()
    expect(overridesOf({ model: 'gpt-6', prompt: '' })).toEqual(['-c', 'model="gpt-6"'])
  })
})
