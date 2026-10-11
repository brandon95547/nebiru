import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ImagePlus,
  RectangleHorizontal,
  RectangleVertical,
  RefreshCw,
  Square,
  StretchHorizontal,
  Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Segmented, Textarea } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Overlay'
import { illustrationStyle } from '@/lib/illustrationStyles'
import { generateIllustration, useJobs } from '@/services/generation'
import { findIllustration, patchLiveIllustration, useEditorHub } from '@/store/editorHub'
import type { Book, IllustrationAttrs, IllustrationPlacement } from '@/types'
import { insertIllustrationAtCursor } from '../actions'

const PLACEMENTS: Array<{ value: IllustrationPlacement; label: ReactNode; title: string }> = [
  { value: 'left', label: <AlignLeft className="size-4" />, title: 'Left, text wraps around' },
  { value: 'center', label: <AlignCenter className="size-4" />, title: 'Centred between paragraphs' },
  { value: 'right', label: <AlignRight className="size-4" />, title: 'Right, text wraps around' },
  { value: 'wide', label: <StretchHorizontal className="size-4" />, title: 'Full width of the text' },
  { value: 'page', label: <RectangleVertical className="size-4" />, title: 'Whole page, edge to edge' },
]

const SHAPES = [
  { value: 'portrait', aspect: 4 / 5, label: <RectangleVertical className="size-4" />, title: 'Portrait' },
  { value: 'square', aspect: 1, label: <Square className="size-4" />, title: 'Square' },
  { value: 'landscape', aspect: 3 / 2, label: <RectangleHorizontal className="size-4" />, title: 'Landscape' },
] as const

function nearestShape(aspect: number): (typeof SHAPES)[number]['value'] {
  return SHAPES.reduce((best, shape) =>
    Math.abs(shape.aspect - aspect) < Math.abs(best.aspect - aspect) ? shape : best,
  ).value
}

export function IllustrationPanel({ book }: { book: Book }) {
  const selected = useEditorHub((state) => state.selectedIllustration)
  const editor = useEditorHub((state) => (selected ? state.editors[selected.chapterId] : undefined))
  const hasCursor = useEditorHub((state) => state.activeChapterId !== null)
  const failure = useJobs((state) => (selected ? state.pictureErrors[selected.id] : undefined))
  // Re-read the node whenever its editor changes.
  useEditorHub((state) => state.tick)

  const target = selected && editor && !editor.isDestroyed ? findIllustration(editor, selected.id) : null

  if (!selected || !editor || !target) {
    return (
      <div className="p-4">
        <p className="text-sm text-ink-soft">
          Click an illustration on the page to change its prompt, size and position. Drag one to move it
          through the text.
        </p>
        <Button variant="secondary" size="sm" className="mt-4 w-full" disabled={!hasCursor} onClick={insertIllustrationAtCursor}>
          <ImagePlus className="size-4" /> Insert at the cursor
        </Button>
        {!hasCursor && <p className="mt-2 text-sm text-ink-mute">Click into the text first to choose where it goes.</p>}
      </div>
    )
  }

  const attrs = target.attrs
  const patch = (change: Partial<IllustrationAttrs>) => patchLiveIllustration(editor, selected.id, change)
  const busy = attrs.status === 'generating'
  const sized = attrs.placement !== 'wide' && attrs.placement !== 'page'

  return (
    <div className="scroll-quiet min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <Field label="Prompt" hint={`Drawn in the book's interior style: ${illustrationStyle(book.interiorStyle).name}.`}>
        <Textarea
          rows={4}
          value={attrs.prompt}
          onChange={(event) => patch({ prompt: event.target.value })}
          placeholder="Describe what the illustration shows"
          className="text-sm"
        />
      </Field>
      <Button className="w-full" disabled={busy || !attrs.prompt.trim()} onClick={() => void generateIllustration(book.id, selected.chapterId, selected.id)}>
        {busy ? <Spinner /> : <RefreshCw className="size-4" />}
        {busy ? 'Drawing…' : attrs.src ? 'Regenerate' : 'Generate'}
      </Button>
      {attrs.status === 'error' && (
        <p role="alert" className="text-sm text-red-300">
          {failure ?? 'The illustration could not be drawn.'}
        </p>
      )}

      <Field label="Position">
        <Segmented label="Position on the page" value={attrs.placement} options={PLACEMENTS} onChange={(placement) => patch({ placement })} />
      </Field>

      {sized && (
        <Field label={`Width: ${attrs.widthPct}% of the text column`}>
          <input
            type="range"
            min={15}
            max={100}
            value={attrs.widthPct}
            onChange={(event) => patch({ widthPct: Number(event.target.value) })}
            className="w-full accent-accent"
          />
        </Field>
      )}

      {attrs.placement !== 'page' && (
        <Field label="Shape" hint="Regenerate after changing the shape so the picture is composed for it.">
          <Segmented
            label="Shape"
            value={nearestShape(attrs.aspect)}
            options={SHAPES.map(({ value, label, title }) => ({ value, label, title }))}
            onChange={(value) => patch({ aspect: SHAPES.find((shape) => shape.value === value)!.aspect })}
          />
        </Field>
      )}

      {attrs.placement !== 'page' && (
        <Field label="Caption">
          <Input value={attrs.caption} onChange={(event) => patch({ caption: event.target.value })} placeholder="Optional" className="h-9 text-sm" />
        </Field>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="w-full text-red-300 hover:text-red-200"
        onClick={() => editor.chain().focus().deleteRange({ from: target.pos, to: target.pos + 1 }).run()}
      >
        <Trash2 className="size-4" /> Remove illustration
      </Button>
    </div>
  )
}
