import type { HookStream, ProcessSpawnChunk, ProcessSpawnRequest, ProcessSpawnResult } from 'claude-code'

import { lines } from './events'

// One `codex app-server`, spoken to in JSON-RPC over its standard input and
// output. A mod's child takes its input once, so the server reads from a FIFO
// in a private temporary folder that the mod writes each message into. The
// shell around it holds the FIFO open while it lives, so the server sees the
// end of its input, and exits, when the shell does; the folder goes with it.

const SHELL = `
d=$(mktemp -d "\${TMPDIR:-/tmp}/codex-mod.XXXXXX") || exit 1
trap 'kill $c 2>/dev/null; rm -rf "$d"' EXIT
trap 'exit 143' TERM HUP INT
mkfifo -m 600 "$d/in" || exit 1
codex app-server "$@" < "$d/in" &
c=$!
exec 3> "$d/in"
printf '{"fifo":"%s"}\\n' "$d/in"
wait $c
`

export type Message = { id?: number | string; method?: string; params?: any; result?: any; error?: any }

// What arrives unasked: a notification, or a request Codex waits on.
export type Incoming = { method: string; params: any; id?: number | string }

export type Server = {
  call: (method: string, params?: unknown) => Promise<any>
  respond: (id: number | string, reply: { result: unknown } | { error: { code: number; message: string } }) => Promise<void>
  // The next message Codex sent unasked; undefined once the server is gone.
  next: () => Promise<Incoming | undefined>
  close: () => void
  stderr: () => string
}

// What the server needs of the engine: a child process, and a file write.
export type Host = {
  spawn: (request: ProcessSpawnRequest) => HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  write: (path: string, text: string) => Promise<void>
}

export async function open(host: Host, args: readonly string[], cwd: string): Promise<Server> {
  const child = host.spawn({ argv: ['sh', '-c', SHELL, 'codex-mod', ...args], cwd })
  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  const inbox: Incoming[] = []
  let wake: (() => void) | undefined
  let fifo: (path: string) => void = () => {}
  let errors = ''
  let isEnded = false
  let lastId = 0
  let writing = Promise.resolve()

  const ended = (async () => {
    let buffer = ''
    try {
      for await (const piece of child) {
        if (piece.stream === 'stderr') {
          errors = (errors + piece.text).slice(-4000)
          continue
        }
        const split = lines(buffer, piece.text)
        buffer = split.rest
        for (const line of split.done) receive(line)
      }
    } catch (err) {
      errors += String(err)
    }
    isEnded = true
    for (const { reject } of waiting.values()) reject(new Error(`codex app-server exited: ${errors.trim().split('\n').at(-1) ?? ''}`))
    waiting.clear()
    wake?.()
  })()

  function receive(line: string): void {
    let message: Message & { fifo?: string }
    try {
      message = JSON.parse(line)
    } catch {
      if (line.trim()) errors = (errors + line + '\n').slice(-4000)
      return
    }
    if (message.fifo) return fifo(message.fifo)
    if (message.method === undefined && typeof message.id === 'number' && waiting.has(message.id)) {
      const call = waiting.get(message.id)!
      waiting.delete(message.id)
      if (message.error) call.reject(new Error(message.error.message ?? JSON.stringify(message.error)))
      else call.resolve(message.result)
      return
    }
    if (message.method !== undefined) {
      inbox.push({ method: message.method, params: message.params, id: message.id })
      wake?.()
    }
  }

  const path = await new Promise<string>((resolve, reject) => {
    fifo = resolve
    void ended.then(() => reject(new Error(`codex app-server did not start: ${errors.trim() || 'no output'}`)))
  })
  const write = (message: object) => {
    writing = writing.then(() => host.write(path, `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`))
    return writing
  }

  const server: Server = {
    call: (method, params) =>
      new Promise((resolve, reject) => {
        if (isEnded) return reject(new Error('codex app-server is not running'))
        const id = ++lastId
        waiting.set(id, { resolve, reject })
        write({ id, method, ...(params === undefined ? {} : { params }) }).catch(reject)
      }),
    respond: (id, reply) => write({ id, ...reply }),
    next: async () => {
      while (inbox.length === 0 && !isEnded) await new Promise<void>(resolve => (wake = resolve))
      return inbox.shift()
    },
    close: () => void child.return({ code: null, signal: null }),
    stderr: () => errors,
  }
  await server.call('initialize', { clientInfo: { name: 'claude-mods-codex', title: 'Claude Code', version: '1' } })
  await write({ method: 'initialized' })
  return server
}
