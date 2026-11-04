export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export type AgentRow = {
  id: string
  label: string
  type: string
  model: string
  status: 'running' | 'idle' | 'completed' | 'failed'
  done: number
  total: number
  /** 'plan' = valore reale da update_plan/TodoWrite; 'estimate' = stima dai tool call. */
  source: 'plan' | 'estimate'
  calls: number
  plan: PlanStatus[]
  slot: number
}

export type FileTouch = {
  /** Percorso relativo al cwd. */
  path: string
  agentIds: string[]
  kind: 'read' | 'edit' | 'write'
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

declare module 'claude-code' {
  interface PluginState {
    'agent-crew': {
      agents: Shaped<AgentRow[]>
      files: Shaped<FileTouch[]>
      /** Percorsi (relativi, le cartelle finiscono con /) del worktree. */
      tree: Shaped<string[]>
      cwd: Shaped<string>
      limits: Shaped<RateLimitRow[]>
      /** Worktree espanso (true) o richiuso (false). */
      worktreeOpen: Shaped<boolean>
    }
  }
}
