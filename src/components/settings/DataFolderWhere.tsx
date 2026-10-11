// Where the app keeps its data, said for the machine it runs on.
//
// Settings, Privacy named one folder, and it was the Windows one:
// "%APPDATA%/Locally Uncensored on Windows (or the equivalent on Linux/macOS)".
// A Mac has no %APPDATA% and the equivalent is not the same name either: chats,
// memories, generated media, logs and the MLX engines live in
// ~/Library/Application Support/lu-labs. So on a Mac the sentence names that
// folder, and takes the path from the app itself instead of from this file.
// Windows and Linux read the sentence they always read.

import { useEffect, useState } from 'react'
import { backendCall, isMacOS, isTauri } from '../../api/backend'

/** Shown until the app has answered, and where it cannot be asked (browser). */
export const MAC_DATA_FOLDER_FALLBACK = '~/Library/Application Support/lu-labs'

/** The folder of the engine's chat models on a Mac, beside the data folder. */
export const MAC_CHAT_MODELS_FOLDER = 'Locally Uncensored/models'

/**
 * The data folder out of the log location. `log_file_path` answers
 * `<data folder>/logs`, built by the same `os_paths::data_dir()` every store,
 * image and video path starts from, so its parent is the real folder, with the
 * real user name and with whatever suffix an experiment build carries. Null
 * when the answer is not shaped like that, so the caller keeps its fallback
 * instead of showing half a path.
 */
export function dataFolderFromLogDir(logDir: unknown): string | null {
  if (typeof logDir !== 'string') return null
  const m = logDir.trim().match(/^(.+)[\\/]logs[\\/]?$/)
  return m ? m[1] : null
}

const CODE = 'px-1 py-0.5 rounded bg-black/5 dark:bg-white/5 t-mono'
// A Mac path is one long word with the user name in it; it may break anywhere.
const CODE_PATH = `${CODE} break-all`

function useMacDataFolder(mac: boolean): string {
  const [folder, setFolder] = useState(MAC_DATA_FOLDER_FALLBACK)
  useEffect(() => {
    if (!mac || !isTauri()) return
    let alive = true
    backendCall<{ dir?: string }>('log_file_path', {})
      .then((loc) => {
        const found = dataFolderFromLogDir(loc?.dir)
        if (alive && found) setFolder(found)
      })
      .catch(() => { /* the fallback stays, it is the right folder on a stock install */ })
    return () => { alive = false }
  }, [mac])
  return folder
}

/** "<folder> on Windows (or the equivalent on Linux/macOS)", or the Mac's own folder. */
export function DataFolderWhere() {
  const mac = isMacOS()
  const folder = useMacDataFolder(mac)
  if (mac) {
    return <><code className={CODE_PATH} data-testid="data-folder-path">{folder}</code> on this Mac</>
  }
  return <><code className={CODE} data-testid="data-folder-path">%APPDATA%/Locally Uncensored</code> on Windows (or the equivalent on Linux/macOS)</>
}

/**
 * What follows the folder under "You own your data". The PC sentence ends on
 * "LU writes nothing else", which a Mac cannot say: the engine's chat models
 * sit in a second folder beside the first. Naming it is the honest version.
 */
export function DataFolderAfterword() {
  if (isMacOS()) {
    return <>Back up the folder, move it between machines, or delete it. Downloaded chat models are kept beside it, in <code className={CODE} data-testid="data-folder-models">{MAC_CHAT_MODELS_FOLDER}</code>.</>
  }
  return <>Back up the folder, move it between machines, or delete it. LU writes nothing else.</>
}
