import { create } from 'zustand'
import type { ToolCallProgress } from '../api/providers/types'
import { preparingWord } from '../components/status/run-status'

/**
 * What a running turn is doing right now, when the run knows more than
 * "Working". Read by WorkingAnchor; an explicit label there (an approval wait,
 * a model load) still wins.
 *
 * Realtime pass 01.10.2026 (R1): while a model writes a tool call, the
 * arguments stream in for seconds (a 4 kB file_write took ~11 s on Mistral
 * Small, measured live) and the run said only "Working". The provider knows
 * the call's name from the first delta, so the anchor says it.
 *
 * Not persisted: a label from a crashed run must not survive a restart.
 */
export interface RunActivity {
  /** Announced to screen readers when it changes. */
  label: string
  /** A count that grows while the label stands (the call's size); shown, not announced. */
  detail?: string
  /** A named state of the run. Without it the label is a call being written. */
  kind?: 'compacting' | 'retrying'
}

interface RunActivityState {
  activity: Record<string, RunActivity>
  setActivity: (conversationId: string | null | undefined, activity: RunActivity | null) => void
}

export const useRunActivityStore = create<RunActivityState>((set) => ({
  activity: {},
  setActivity: (conversationId, activity) => {
    if (!conversationId) return
    set((state) => {
      const now = state.activity[conversationId]
      if (now?.label === activity?.label && now?.detail === activity?.detail && now?.kind === activity?.kind) return state
      const next = { ...state.activity }
      if (activity) next[conversationId] = activity
      else delete next[conversationId]
      return { activity: next }
    })
  },
}))

/**
 * "Preparing to write", plus the size once a kilobyte has arrived. Whole kB,
 * so the store changes at most once per kB. The words come from the same
 * table as the status of a running tool (components/status/run-status.ts).
 */
export function toolProgressActivity(progress: ToolCallProgress): RunActivity {
  const kb = Math.floor(progress.argsChars / 1024)
  const label = preparingWord(progress.name)
  return kb > 0 ? { label, detail: `${kb} kB` } : { label }
}

/** The older part of the conversation is being summarized before the request goes out. */
export const COMPACTING_ACTIVITY: RunActivity = { label: 'Compacting', kind: 'compacting' }

/**
 * Wait before a model call is tried again, and say so for as long as the wait
 * lasts. The line is taken back before the next attempt, so the attempt shows
 * as what it is. A wait can last a minute when a server names it, so Stop
 * (`signal`) ends it at once.
 */
export async function waitBeforeRetry(conversationId: string | null | undefined, ms: number, signal?: AbortSignal): Promise<void> {
  const { setActivity } = useRunActivityStore.getState()
  setActivity(conversationId, { label: 'Retrying', kind: 'retrying' })
  let stop: (() => void) | null = null
  try {
    await new Promise<void>((resolve) => {
      if (signal?.aborted) { resolve(); return }
      const timer = setTimeout(resolve, ms)
      stop = () => { clearTimeout(timer); resolve() }
      signal?.addEventListener('abort', stop, { once: true })
    })
  } finally {
    if (stop) signal?.removeEventListener('abort', stop)
    if (conversationId && useRunActivityStore.getState().activity[conversationId]?.kind === 'retrying') setActivity(conversationId, null)
  }
}
