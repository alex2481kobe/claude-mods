// The codex agent whose view is open, if any, and the reply to the last
// /codex- command run in each such view. The band above the prompt sees the
// view (a render hook may not write $.state, so it is kept here) and draws the
// reply; a command reads the view. Display only: a reload drops both, and
// the next draw sets the view again.

let open: string | undefined
const replies = new Map<string, string>()

export function openView(): string | undefined {
  return open
}

// Says whether the open view changed; leaving a view drops its reply.
export function setOpenView(agentId: string | undefined): boolean {
  if (agentId === open) return false
  if (open !== undefined) replies.delete(open)
  open = agentId
  return true
}

export function replyIn(agentId: string): string | undefined {
  return replies.get(agentId)
}

export function setReply(agentId: string, reply: string): void {
  replies.set(agentId, reply)
}
