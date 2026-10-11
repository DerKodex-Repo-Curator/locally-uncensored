import type { GalleryItem } from '../../../stores/createStore'
import { hasPromptPanel, ranPrompt } from '../../../lib/render/ran-prompt'
import { CopyText } from './CopyText'
import { cn } from '../ui/cn'

/** What the panel reads of a result. A gallery item carries all of it, a
 *  result in the chat only the prompt of its run. */
export type PromptSource = Pick<GalleryItem, 'prompt'>
  & Partial<Pick<GalleryItem, 'promptOriginal' | 'rewrittenBy' | 'improveFailed' | 'label' | 'intent' | 'type'>>

/** One text with its copy button. A lone prompt needs no second heading, the
 *  fold already says "Prompt": the button then sits next to the text. */
function PromptText({ title, text, copyLabel }: { title?: string; text: string; copyLabel: string }) {
  const body = <p data-testid="prompt-text" className="t-body min-w-0 select-text whitespace-pre-wrap break-words text-gray-300">{text}</p>
  if (!title) {
    return (
      <div className="flex items-start justify-between gap-3">
        {body}
        <CopyText text={text} label={copyLabel} />
      </div>
    )
  }
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between gap-3">
        <div className="t-label text-gray-500">{title}</div>
        <CopyText text={text} label={copyLabel} />
      </div>
      {body}
    </div>
  )
}

// The prompt of a result, with a button that copies it: the twin of the web
// app's panel. With "Improve my prompt" it shows what the customer wrote next
// to what actually ran, and who rewrote it. Shows nothing for a result that
// has no prompt (a cutout, an entry that never saved one), never a made-up
// text (lib/render/ran-prompt.ts).
export function PromptDetails({ item, className, open = false }: {
  item: PromptSource
  className?: string
  /** Unfolded from the start: the large view. Under the stage it stays folded. */
  open?: boolean
}) {
  const prompt = ranPrompt(item)
  if (!hasPromptPanel(item)) return null
  return (
    <details
      open={open}
      data-testid="prompt-details"
      className={cn('w-full max-w-xl rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2 text-left', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <summary className="t-control cursor-pointer select-none text-gray-400 hover:text-gray-200">Prompt</summary>
      <div className="mt-2 space-y-2">
        {item.promptOriginal ? (
          <>
            <PromptText title="You wrote" text={item.promptOriginal} copyLabel="Copy what you wrote" />
            {prompt && <PromptText title="Sent to the model" text={prompt} copyLabel="Copy what was sent to the model" />}
            {item.rewrittenBy && (
              <div>
                <div className="t-label text-gray-500">Rewritten by</div>
                <p className="t-body break-words text-gray-300">{item.rewrittenBy}</p>
              </div>
            )}
          </>
        ) : (
          prompt && <PromptText text={prompt} copyLabel="Copy prompt" />
        )}
        {item.improveFailed && !item.promptOriginal && (
          <p className="t-body text-gray-400">
            Improve my prompt was on, but the rewrite did not work. This run used your own prompt.
          </p>
        )}
      </div>
    </details>
  )
}
