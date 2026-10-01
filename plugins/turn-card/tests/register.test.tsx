import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROW = { text: 'hi there', origin: { kind: 'composer' }, isExpanded: false } as const

// The kit cannot complete session.append (nothing sits beneath it) and its $
// has no state noun, so a row with kept stats is checked live, not here.
describe('register', () => {
  test('a prompt row with no kept stats draws as the engine draws it', async ($, on) => {
    // Stands for the engine's own drawing of the row.
    on('ui.render', { component: 'UserMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.text}</Text>
    })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'turn-card', surface, component: 'UserMessage', props: ROW, requestId: 'p1' })
      expect(await ui.find({ text: /hi there/ })).toBeDefined()
      expect(await ui.find({ text: /out tokens/ })).toBeUndefined()
      await ui.unmount()
    }
  })
})
