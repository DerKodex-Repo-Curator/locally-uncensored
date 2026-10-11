// The lines Create shows before a video run on a Mac: one where the Mac has
// less memory than the lane's model is recommended for, one where the clip
// as set would take long (lib/mlx-video-progress.ts, longVideoRunLine).
//
// The catalogue names two numbers for such a model: the memory it is
// recommended for, and the least a run is let through with (`memory_refusal`
// in src-tauri/src/commands/video.rs refuses below it). Between the two a run
// starts. Wan 2.1 T2V 1.3B peaked at 24.5 GB on a Mac with 48 GB (real run,
// 09.10.2026) and nobody has run it on a smaller one, so a Mac with 16 or
// 24 GB is neither refused nor left without a word: this is the word.

import { useEffect, useState } from 'react'
import { Clock, Cpu } from 'lucide-react'
import { useCreateStore } from '../../../stores/createStore'
import { Hinweis } from '../../ui/Hinweis'
import { isMlxImageHost } from '../../../api/mlx-image'
import { MLX_VIDEO_MODEL_PREFIX, mlxFramesOnGrid, mlxVideoLaneEntry, mlxVideoSeconds } from '../../../api/mlx-video'
import { getSharedMemoryGb } from '../../../lib/hardware'
import { fitsMacMemory } from '../../../lib/mac-memory-fit'
import { longVideoRunLine } from '../../../lib/mlx-video-progress'

function bareName(name: string): string {
  return name.startsWith(MLX_VIDEO_MODEL_PREFIX) ? name.slice(MLX_VIDEO_MODEL_PREFIX.length) : name
}

/** The sentence, or null where the model sits in this Mac's memory or one of
 *  the two numbers is not known. */
export function macVideoMemoryLine(name: string, recommendedRamGB: number | undefined, memoryGb: number | null): string | null {
  if (!recommendedRamGB || fitsMacMemory(recommendedRamGB, memoryGb) !== false) return null
  const model = bareName(name)
  return `${model} is recommended for Macs with ${recommendedRamGB} GB of memory, and this one has ${Math.round(memoryGb ?? 0)} GB. `
    + 'It has not been measured on a Mac this size: a run can be very slow or stop for lack of memory. Close other apps before you start.'
}

export function MacVideoMemoryNotice() {
  const backend = useCreateStore((s) => s.backend)
  const intent = useCreateStore((s) => s.intent())
  const videoModelList = useCreateStore((s) => s.videoModelList)
  const videoModel = useCreateStore((s) => s.videoModel)
  const frames = useCreateStore((s) => s.frames)
  // Only where the Mac runs video itself. Everywhere else nothing is read.
  const lane = backend === 'local' && isMlxImageHost() && (intent === 'video' || intent === 'animate')
  const [memoryGb, setMemoryGb] = useState<number | null>(null)
  useEffect(() => {
    if (!lane) return
    let stale = false
    getSharedMemoryGb().then((gb) => { if (!stale && gb > 0) setMemoryGb(gb) }).catch(() => {})
    return () => { stale = true }
  }, [lane])
  if (!lane) return null
  const entry = mlxVideoLaneEntry(videoModelList, videoModel, intent)
  const line = entry ? macVideoMemoryLine(entry.name, entry.mlxVideo?.recommendedRamGB, memoryGb) : null
  // The length the run would make: the slider's frames on the model's grid,
  // at the model's rate, the way the run itself counts them (useCreate).
  const clip = entry?.mlxVideo
  const duration = entry && clip
    ? longVideoRunLine(bareName(entry.name), mlxVideoSeconds(mlxFramesOnGrid(frames, clip.frameStep), clip.fps), clip.measuredRunSecondsPerClipSecond)
    : null
  if (!line && !duration) return null
  return (
    <>
      {line && (
        <Hinweis icon={<Cpu size={12} className="shrink-0 mt-px" />} className="px-4 py-2 shrink-0">
          <span data-testid="mac-video-memory-notice">{line}</span>
        </Hinweis>
      )}
      {duration && (
        <Hinweis icon={<Clock size={12} className="shrink-0 mt-px" />} className="px-4 py-2 shrink-0">
          <span data-testid="mac-video-duration-notice">{duration}</span>
        </Hinweis>
      )}
    </>
  )
}
