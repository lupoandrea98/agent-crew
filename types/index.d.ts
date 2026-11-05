export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export type AgentRow = {
  id: string
  label: string
  model: string
  status: 'running' | 'idle' | 'completed' | 'failed'
  done: number
  total: number
  calls: number
  plan: PlanStatus[]
  slot: number
}

export type FileTouch = {
  /** Percorso relativo al cwd. */
  path: string
  agentIds: string[]
  kind: 'read' | 'edit' | 'write' | 'delete'
  status: 'active' | 'done'
  added: number
  removed: number
  at: number
}

export type RateLimitRow = {
  /** 'five_hour' | 'seven_day' */
  kind: string
  /** 0-100 */
  percentUsed: number
  /** ISO 8601 */
  resetsAt?: string
}

export type ContextRow = {
  /** 0-100 di contesto usato; null finche' non e' noto. */
  percent: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-crew': {
      agents: Shaped<AgentRow[]>
      files: Shaped<FileTouch[]>
      /** Percorsi (relativi, le cartelle finiscono con /) del worktree. */
      tree: Shaped<string[]>
      cwd: Shaped<string>
      limits: Shaped<RateLimitRow[]>
      context: Shaped<ContextRow>
      /** Worktree espanso (true) o richiuso (false). */
      worktreeOpen: Shaped<boolean>
    }
  }
}
