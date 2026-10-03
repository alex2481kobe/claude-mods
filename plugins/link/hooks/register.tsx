import type { Register } from 'claude-code'

import { absolute, candidates, hrefOf, linkify, targetOf } from './paths'

// The most a Markdown element draws; a longer reply keeps the engine's drawing.
const MARKDOWN_LIMIT = 10000
// The mark the engine draws before a reply on macOS, the one platform `open -R` has.
const BULLET = '\u23fa '

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const found = candidates(e.props.text)
    if (found.length === 0) return next(e)

    const cwd = await $.session.cwd()
    const home = (await $.env.get('HOME')) ?? ''
    const hrefs = new Map<string, string>()
    for (const path of found) {
      if (path.startsWith('~') && home === '') continue
      const full = absolute(path, cwd, home)
      const stat = await $.fs.stat(full).catch(() => undefined)
      if (stat) hrefs.set(path, hrefOf(full, stat.kind === 'dir'))
    }
    const text = linkify(e.props.text, hrefs)
    if (hrefs.size === 0 || text.length > MARKDOWN_LIMIT) return next(e)

    // The engine's own frame of a reply block: a blank row above, the bullet
    // opening a reply or its width in spaces, then the markdown.
    const { Box, Markdown, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" marginTop={1}>
        <Text color="text">{e.props.isFirstOfReply ? BULLET : '  '}</Text>
        <Box flexGrow={1}>
          <Markdown
            key="link"
            text={text}
            pressableLinks={[...hrefs.values()]}
            onLinkPress={async link => {
              const target = targetOf(link.href)
              if (target === undefined) return
              const { exitCode, stderr } = await $.process.run(target.argv)
              $.ui.toast(exitCode === 0 ? target.done : `${target.failed}: ${stderr.trim() || `exit ${exitCode}`}`)
            }}
          />
        </Box>
      </Box>
    )
  })
}
