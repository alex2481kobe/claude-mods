import { describe, expect, test } from 'claude-code/testing'

import { definitionOf, labelOf, nameOf } from '../hooks/label'

const PARENT = { fork: false, isBuiltIn: true, parentModel: 'claude-opus-5-5', parentEffort: 'high' }

describe('labelOf', () => {
  test('general-purpose runs on the parent model and effort', () => {
    expect(labelOf({ ...PARENT, type: 'general-purpose' })).toBe('Opus 5.5 (high)')
  })

  test('a fork runs on the parent model whatever model it names', () => {
    expect(labelOf({ ...PARENT, type: 'fork', fork: true, model: 'haiku' })).toBe('Opus 5.5 (high)')
  })

  test('an agent file names the model and effort', () => {
    const definition = { name: 'checker', model: 'claude-sonnet-5-5', effort: 'medium' }
    expect(labelOf({ ...PARENT, type: 'checker', isBuiltIn: false }, definition)).toBe('Sonnet 5.5 (medium)')
  })

  test('another model given to the tool does not take the parent effort', () => {
    expect(labelOf({ ...PARENT, type: 'general-purpose', model: 'haiku' })).toBe('Haiku')
  })

  test('an agent file asking to inherit runs on the parent', () => {
    const definition = { name: 'x', model: 'inherit' }
    expect(labelOf({ ...PARENT, type: 'x', isBuiltIn: false }, definition)).toBe('Opus 5.5 (high)')
  })

  test('no label where the model cannot be known here', () => {
    expect(labelOf({ ...PARENT, type: 'Explore' })).toBeUndefined()
    expect(labelOf({ ...PARENT, type: 'plain', isBuiltIn: false }, { name: 'plain' })).toBeUndefined()
    expect(labelOf({ ...PARENT, type: 'missing', isBuiltIn: false })).toBeUndefined()
  })

  test('a plugin type labels itself', () => {
    expect(labelOf({ ...PARENT, type: 'codex:read', model: 'haiku' })).toBeUndefined()
  })

  test('no effort when the parent request had none', () => {
    expect(labelOf({ ...PARENT, type: 'general-purpose', parentEffort: undefined })).toBe('Opus 5.5')
  })
})

describe('definitionOf', () => {
  test('reads name, model and effort from the frontmatter', () => {
    const text = '---\nname: checker\ndescription: Reviews.\nmodel: "claude-sonnet-5-5"\neffort: medium\n---\n\nBody.\n'
    expect(definitionOf(text, 'checker.md')).toEqual({ name: 'checker', model: 'claude-sonnet-5-5', effort: 'medium' })
  })

  test('the frontmatter name wins over the file name, which stands in for none', () => {
    expect(definitionOf('---\nname: renamed\n---\n', 'file.md')?.name).toBe('renamed')
    expect(definitionOf('---\nmodel: opus\n---\n', 'file.md')).toEqual({ name: 'file', model: 'opus', effort: undefined })
  })

  test('a file without frontmatter is no agent', () => {
    expect(definitionOf('# Notes\n', 'notes.md')).toBeUndefined()
  })
})

describe('nameOf', () => {
  test('claude ids and aliases read as people say them', () => {
    expect(nameOf('claude-opus-5-5')).toBe('Opus 5.5')
    expect(nameOf('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(nameOf('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(nameOf('haiku')).toBe('Haiku')
    expect(nameOf('some-other-model')).toBe('some-other-model')
  })
})
