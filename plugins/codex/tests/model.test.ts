import { describe, expect, test } from 'claude-code/testing'

import { flagsOf, type Flags } from '../hooks/flags'
import { configOf, labelOf, modelsOf } from '../hooks/model'

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

const flags = (text: string, pin?: { sandbox: string }) => flagsOf(text, pin) as Flags

describe('flags', () => {
  test('leading model and effort lines choose and are dropped from the task', () => {
    const f = flags('model: gpt-6-astra\neffort: high\nReview app.js')
    expect(f).toMatchObject({ model: 'gpt-6-astra', effort: 'high', prompt: 'Review app.js' })
    expect(f.args).toEqual(['-c', 'model="gpt-6-astra"', '-c', 'model_reasoning_effort="high"'])
  })

  test('a prompt without them is passed as is, prose included', () => {
    expect(flags('Review app.js\nmodel: x')).toMatchObject({ args: [], prompt: 'Review app.js\nmodel: x' })
    expect(flags('search the code for x')).toMatchObject({ args: [], prompt: 'search the code for x' })
  })

  test('a value that could break out of the override is refused, not passed', () => {
    expect(flagsOf('model: a" -c x="y\nReview')).toEqual({ error: 'model needs a plain value, not "a" -c x="y"' })
  })

  test('every exec flag spelling reaches Codex as the setting it names', () => {
    const f = flags(
      '--sandbox danger-full-access\n-a never\napprove-for-me\nconfig: tools.view_image=false\n--enable foo\nsearch\nadd-dir: /data\nlocal-provider: ollama\nstrict-config\nDo it',
    )
    expect(f.args).toEqual([
      '-c', 'sandbox_mode="danger-full-access"',
      '-c', 'approval_policy="never"',
      '-c', 'approvals_reviewer="auto_review"', '-c', 'sandbox_mode="workspace-write"',
      '-c', 'tools.view_image=false',
      '--enable', 'foo',
      '-c', 'web_search="live"',
      '-c', 'model_provider="ollama"',
      '--strict-config',
    ])
    expect(f.addDirs).toEqual(['/data'])
    expect(f.prompt).toBe('Do it')
  })

  test('dangerously-bypass sets what the exec flag does', () => {
    expect(flags('dangerously-bypass-approvals-and-sandbox\nx').args).toEqual([
      '-c', 'sandbox_mode="danger-full-access"', '-c', 'approval_policy="never"',
    ])
  })

  test('a pinned type keeps its sandbox and refuses a flag that changes it', () => {
    expect(flags('model: m\nx', { sandbox: 'read-only' }).args).toEqual([
      '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"', '-c', 'model="m"',
    ])
    expect(flagsOf('approve-for-me\nx', { sandbox: 'read-only' })).toHaveProperty('error')
    expect(flagsOf('config: sandbox_mode="danger-full-access"\nx', { sandbox: 'read-only' })).toHaveProperty('error')
  })

  test('a flag codex app-server cannot take says why instead of being dropped', () => {
    expect(flagsOf('profile: fast\nx')).toEqual({ error: 'profile: codex app-server takes no --profile; set the values with config: lines' })
    expect(flagsOf('sandbox: everything\nx')).toHaveProperty('error')
    expect(flagsOf('approve-for-me: maybe\nx')).toHaveProperty('error')
  })
})
