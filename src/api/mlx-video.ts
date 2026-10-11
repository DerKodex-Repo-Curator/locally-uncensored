/**
 * MLX-video pipeline (Apple Silicon), running IN-PROCESS — Rust
 * (`commands::video`) spawns `python -m mlx_video.<family>.generate` as a
 * subprocess directly, no separate lu-bridge daemon. Ported from
 * the web app; the transport is a direct Tauri `invoke` via
 * `invokeMedia` (api/mlx-invoke) and progress is exposed for the frontend
 * to poll.
 *
 * Hard rule: this is the Mac local video backend, NOT ComfyUI. Only Apple
 * Silicon Macs see a real surface — every call returns `available:false`
 * elsewhere so the UI can dim/skip it.
 */
import { backendCall } from './backend'
import { invokeMedia } from './mlx-invoke'
import type { ClassifiedModel, ModelType } from './comfyui'
import { siGbToBytes } from '../lib/formatters'
import { memoryNeedGb } from '../lib/mac-memory-fit'

export interface VideoStatus {
  available: boolean
  appleSilicon: boolean
  mlxInstalled: boolean
  mlxVersion: string | null
  /** The second engine (ltx-2-mlx), which runs the quantized LTX packs. It has
   *  no setup step of its own: it installs with the first model that needs it. */
  ltx2MlxInstalled?: boolean
  ltx2MlxVersion?: string | null
  pythonBin: string | null
  modelsRoot: string
  outputsRoot: string
  installedModels: string[]
  running: boolean
}

export interface VideoModel {
  id: string
  name: string
  family: 'wan_2' | 'ltx_2' | 'ltx_2q' | string
  repo: string
  /** Wie der Katalog sie fuehrt: in Dezimal-GB. Fuer Text nie direkt nehmen. */
  sizeGB: number
  /** Dieselbe Groesse in Bytes, am Rand gerechnet. Siehe `MlxImageModel`. */
  sizeBytes: number
  /** Below this a run is refused (`memory_refusal` in video.rs). */
  minRamGB: number
  /** What the model is recommended for, and what a tile and the memory filter
   *  go by. Above `minRamGB` for the small Wan entries, whose text encoder was
   *  measured at 25.6 GB and which nobody has run on a smaller Mac. */
  recommendedRamGB?: number
  /** Seconds a run took per second of clip on the one Mac it was timed on
   *  (an M5 Pro with 48 GB). 0 or absent where nobody has timed one. */
  measuredRunSecondsPerClipSecond?: number
  /** The text encoder a Get still fetches on top of `sizeGB`, in decimal GB.
   *  0 when the repository carries it or it is on disk already. */
  textEncoderGB?: number
  /** The model the one-click setup of Create takes where it fits. */
  starter?: boolean
  defaultFrames: number
  /** The rate the engine writes a clip of this model at (`frame_rate` in
   *  video.rs). Create counts seconds with it and assumes none of its own. */
  fps: number
  /** The size a run has. Create cannot change it. */
  defaultWidth: number
  defaultHeight: number
  /** Whether a negative prompt reaches the model. False: do not show the field. */
  negativePrompt: boolean
  /** Whether steps and guidance set in Create reach a run. False for every
   *  local video model: `video_generate` passes neither. */
  userSampling: boolean
  needsConvert: boolean
  unfiltered: boolean
  /** The model animates a start image and cannot run from text alone. */
  requiresImage?: boolean
  /** The model can start from an image. The catalogue in
   *  `src-tauri/src/commands/video.rs` decides this per entry, from what the
   *  engine does with the checkpoint, and nothing here second-guesses it. */
  acceptsImage?: boolean
  description: string
  installed: boolean
}

export interface VideoProgress {
  running: boolean
  status: 'idle' | 'installing' | 'complete' | 'error' | string
  logs: string[]
  error: string | null
}

export interface InstallStatus {
  status: 'idle' | 'installing' | 'complete' | 'error'
  logs: string[]
  download_progress: number
  download_total: number
  download_speed: number
  error: string | null
}

export interface GenerateParams {
  id: string
  prompt: string
  seconds?: number
  fps?: number
  initImage?: string
  seed?: number
  /** Only for a model whose entry says `negativePrompt`: nothing else reads it. */
  negativePrompt?: string
}

export interface GenerateResult {
  ok: boolean
  jobId: string
  pid: number
  output: string
}

export async function getVideoStatus(): Promise<VideoStatus> {
  return invokeMedia<VideoStatus>('video_status')
}

export async function listVideoModels(): Promise<VideoModel[]> {
  const catalog = await invokeMedia<VideoModel[]>('video_list_models')
  // Dieselbe Grenze wie beim Bildkatalog: `src-tauri/src/commands/video.rs`
  // rechnet seine Groessen mit `size_gb as f64 * 1e9` in Bytes um, zaehlt also
  // in Dezimal-GB.
  return catalog.map((m) => ({ ...m, sizeBytes: siGbToBytes(m.sizeGB) }))
}

export async function installMlxVideo(): Promise<{ ok: boolean; status: string }> {
  return invokeMedia<{ ok: boolean; status: string }>('video_install_mlx')
}

export async function getMlxInstallStatus(): Promise<InstallStatus> {
  return invokeMedia<InstallStatus>('video_install_mlx_status')
}

export async function installVideoModel(
  id: string,
): Promise<{ ok: boolean; status: string; id?: string }> {
  return invokeMedia('video_install_model', { id })
}

export async function getModelInstallStatus(): Promise<InstallStatus> {
  return invokeMedia<InstallStatus>('video_install_model_status')
}

/** Stop the model download that is running. See `cancelMlxImageInstall`. */
export async function cancelVideoModelInstall(): Promise<{ ok: boolean; cancelled: boolean }> {
  return invokeMedia('video_cancel_model_install')
}

export async function deleteVideoModel(id: string): Promise<{ ok: boolean; id: string }> {
  return invokeMedia('video_delete_model', { id })
}

export async function generateVideo(params: GenerateParams): Promise<GenerateResult> {
  const body = {
    id: params.id,
    prompt: params.prompt,
    seconds: params.seconds,
    fps: params.fps,
    init_image: params.initImage,
    seed: params.seed,
    negative_prompt: params.negativePrompt?.trim() || undefined,
  }
  // Kick off the subprocess; generation itself is polled via video_progress.
  return invokeMedia<GenerateResult>('video_generate', body)
}

export async function getVideoProgress(): Promise<VideoProgress> {
  return invokeMedia<VideoProgress>('video_progress')
}

export async function cancelVideo(): Promise<{ ok: boolean }> {
  return invokeMedia<{ ok: boolean }>('video_cancel')
}

// ── blob: URL ownership ────────────────────────────────────────────────────
//
// A `blob:` URL pins its Blob in the renderer until someone revokes it, and an
// MLX clip is tens to hundreds of megabytes. The old contract here was "caller
// owns the returned URL's lifetime (revoke it when the gallery item is
// dropped, if ever)" — and "if ever" is what actually happened: nothing
// revoked, so every render of a session stayed resident and a long Create
// session grew until the WebView died. This module owns the URLs it mints
// instead, and `createStore` calls `releaseVideoBlobUrl` when an item leaves
// the gallery.
//
// Keyed by source path so re-reading the same file (a restored tile, a retry)
// replaces its predecessor rather than stacking a second copy of the clip.
const blobUrlByPath = new Map<string, string>()

/** 4 MiB of base64 ≈ 3 MiB of video per slice. Big enough that the loop
 *  overhead is irrelevant, small enough that the renderer gets a frame in
 *  between — a 200 MB clip used to hold the main thread for the whole decode
 *  in one go, which is a visibly frozen app, not a slow one. */
const DECODE_CHUNK = 4 * 1024 * 1024

/** Give the event loop a real turn (a microtask would not let anything paint). */
const yieldToRenderer = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function decodeBase64(b64: string): Promise<Uint8Array<ArrayBuffer>> {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let start = 0; start < binary.length; start += DECODE_CHUNK) {
    const end = Math.min(start + DECODE_CHUNK, binary.length)
    for (let i = start; i < end; i++) bytes[i] = binary.charCodeAt(i)
    if (end < binary.length) await yieldToRenderer()
  }
  return bytes
}

/** Read a finished MLX video's bytes (via the `read_media_file` Rust command,
 *  guarded to the app's own video output dir) and turn them into a `blob:`
 *  URL — the CSP's `media-src` allows `blob:` but not `data:`, so this is
 *  the only way to get `<video>` playback + Download working now that the
 *  old lu-bridge (:47711/videos/<file>) is gone.
 *
 *  The returned URL is owned by this module: it is revoked when the same path
 *  is read again, and when `releaseVideoBlobUrl` is called for it. */
export async function readVideoAsBlobUrl(path: string): Promise<string> {
  const b64 = await backendCall<string>('read_media_file', { path })
  const bytes = await decodeBase64(b64)
  const blob = new Blob([bytes], { type: 'video/mp4' })
  const url = URL.createObjectURL(blob)
  const previous = blobUrlByPath.get(path)
  if (previous) URL.revokeObjectURL(previous)
  blobUrlByPath.set(path, url)
  return url
}

/**
 * Drop a URL this module minted. Safe to call with anything: a non-blob URL, a
 * URL from another source, `undefined` — only a `blob:` string is revoked, and
 * only entries this module is still tracking are forgotten.
 *
 * Revoking is idempotent, so a double call (item removed, then the gallery
 * cleared) costs nothing.
 */
export function releaseVideoBlobUrl(url: string | null | undefined): void {
  if (!url || !url.startsWith('blob:')) return
  for (const [path, held] of blobUrlByPath) {
    if (held === url) {
      blobUrlByPath.delete(path)
      break
    }
  }
  URL.revokeObjectURL(url)
}

/** Revoke everything still held. For a full gallery clear, and for tests. */
export function releaseAllVideoBlobUrls(): void {
  for (const url of blobUrlByPath.values()) URL.revokeObjectURL(url)
  blobUrlByPath.clear()
}

/** How many URLs this module is still holding. Test-facing; a leak is a
 *  number that only ever goes up. */
export function heldVideoBlobUrlCount(): number {
  return blobUrlByPath.size
}

// ── Create-tab wiring (mirrors mlx-image.ts's synthetic-model pattern) ──
//
// On macOS the video picker shows the installed MLX catalog directly — there
// is no ComfyUI video backend to merge with (hard rule: Mac video is MLX
// only). A "MLX " prefix keeps these display names visually distinct and
// guarantees a fresh persisted `videoModel` never collides with a stale
// ComfyUI checkpoint name from a pre-MLX session.

export const MLX_VIDEO_MODEL_PREFIX = 'MLX '

export function mlxVideoDisplayName(m: Pick<VideoModel, 'name'>): string {
  return `${MLX_VIDEO_MODEL_PREFIX}${m.name}`
}

const mlxVideoIdByDisplayName = new Map<string, string>()

/** What a catalogue entry does with a start image, in the words Create's
 *  lanes filter by (`canRunVideoLane`). A model that needs one takes one,
 *  whatever the second flag says. */
export function mlxVideoStartImage(m: Pick<VideoModel, 'acceptsImage' | 'requiresImage'>): 'none' | 'optional' | 'required' {
  return m.requiresImage ? 'required' : m.acceptsImage ? 'optional' : 'none'
}

/** Whether Animate Image has a local lane on this Mac: one installed model
 *  that starts from an image is enough, and without one the tab would only
 *  lead to a picker with nothing in it. */
export function mlxTakesStartImage(list: readonly Pick<ClassifiedModel, 'startImage'>[]): boolean {
  return list.some((m) => m.startImage === 'optional' || m.startImage === 'required')
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error ?? new Error('the image could not be read'))
    r.readAsDataURL(blob)
  })
}

/** Write a start image to disk and return its path. `video_generate` takes a
 *  start image as a file, and an image picked in the WebView has no path:
 *  this is what `/upload/image` is on a ComfyUI host. */
export async function stageStartImage(image: Blob): Promise<string> {
  const { path } = await invokeMedia<{ path: string }>('video_stage_start_image', { data: await blobToBase64(image) })
  return path
}

/** Resolve a video dropdown selection back to the bridge catalog id. */
export function mlxVideoModelIdFor(displayName: string | null | undefined): string | null {
  return (displayName && mlxVideoIdByDisplayName.get(displayName)) || null
}

/** Both LTX families are LTX to Create: `ltx_2` on mlx-video and `ltx_2q`,
 *  the quantized packs on the second engine. Everything else is a Wan. */
export function mlxVideoModelType(family: string): ModelType {
  return family === 'ltx_2' || family === 'ltx_2q' ? 'ltx' : 'wan'
}

/** The grid a frame count sits on: both LTX engines want `8k + 1`, the Wan
 *  VAE wants `4n + 1` (`clamp_frames` in video.rs and video_ltx2mlx.rs). */
export function mlxVideoFrameStep(family: string): number {
  return family === 'ltx_2' || family === 'ltx_2q' ? 8 : 4
}

/** The shortest clip with any motion in it, on both grids. */
export const MLX_VIDEO_MIN_FRAMES = 9

/** The longest clip Create offers on this grid. The store holds at most 120
 *  frames, so it is the last grid point below that. */
export function mlxVideoMaxFrames(frameStep: number): number {
  return 120 - ((120 - 1) % frameStep)
}

/** A frame count put on the model's grid, the way the engine would floor it,
 *  so the number on the slider is the number of frames in the clip. */
export function mlxFramesOnGrid(frames: number, frameStep: number): number {
  const f = Math.min(mlxVideoMaxFrames(frameStep), Math.max(MLX_VIDEO_MIN_FRAMES, Math.floor(frames) || 0))
  return f - ((f - 1) % frameStep)
}

/**
 * The length `video_generate` is asked for, so that it makes exactly
 * `frames` frames. Rust multiplies by the rate and cuts the fraction off, and
 * 49 / 24 * 24 does not come back as 49 in every float. Half a frame of
 * margin survives the cut.
 */
export function mlxVideoSeconds(frames: number, fps: number): number {
  return (frames + 0.5) / Math.max(1, fps)
}

/** The lane's model: the stored pick where the lane can run it, else the
 *  first one it can run. The same rule as the model chip and the run. */
export function mlxVideoLaneEntry<T extends Pick<ClassifiedModel, 'name' | 'startImage' | 'mlxVideo'>>(
  list: readonly T[] | null | undefined, stored: string, intent: string,
): T | undefined {
  const needsImage = intent === 'animate' || intent === 'extend'
  // A list that has not arrived yet is no list, not an error.
  const lane = (list ?? []).filter((m) => (needsImage ? m.startImage !== 'none' : m.startImage !== 'required'))
  return lane.find((m) => m.name === stored) ?? lane[0]
}

/** Build the Create-tab video model list from the installed MLX catalog. */
export function buildMlxVideoModels(catalog: VideoModel[]): ClassifiedModel[] {
  return catalog
    .filter((m) => m.installed)
    .map((m) => {
      mlxVideoIdByDisplayName.set(mlxVideoDisplayName(m), m.id)
      return {
        name: mlxVideoDisplayName(m), type: mlxVideoModelType(m.family), source: 'checkpoint',
        startImage: mlxVideoStartImage(m),
        mlxVideo: {
          frames: mlxFramesOnGrid(m.defaultFrames, mlxVideoFrameStep(m.family)),
          // The rate, the size and whether a negative prompt is read are the
          // entry's own (`video_list_models`). Create assumes none of them: a
          // rate guessed from the family went out as a wrong number of frames
          // (49 frames at Wan's 16 became 73 on an LTX: persona walk,
          // 09.10.2026, Fund 19).
          fps: m.fps,
          frameStep: mlxVideoFrameStep(m.family),
          width: m.defaultWidth,
          height: m.defaultHeight,
          negativePrompt: m.negativePrompt === true,
          recommendedRamGB: memoryNeedGb(m),
          measuredRunSecondsPerClipSecond: m.measuredRunSecondsPerClipSecond || undefined,
        },
      } satisfies ClassifiedModel
    })
}
