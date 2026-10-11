import { Node } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Spinner } from '@/components/ui/Overlay'
import { newIllustration } from '@/lib/doc'
import { clamp, cx } from '@/lib/util'
import type { IllustrationAttrs } from '@/types'

const DEFAULTS = newIllustration({ id: '' })
const MIN_WIDTH_PCT = 15

/**
 * The editable illustration. It renders the same figure markup as the
 * node's static HTML so pages break identically in the editor, the
 * thumbnails and the preview.
 */
function IllustrationView({ node, selected, editor, updateAttributes }: NodeViewProps) {
  const attrs = node.attrs as IllustrationAttrs
  const editable = editor.isEditable
  const resizable = editable && selected && attrs.placement !== 'wide' && attrs.placement !== 'page'

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const column = event.currentTarget.closest('figure')?.parentElement?.getBoundingClientRect().width
    if (!column) return
    const startX = event.clientX
    const startPct = attrs.widthPct
    // The handle sits on the outer corner, and a centred figure grows on both sides.
    const direction = attrs.placement === 'right' ? -1 : 1
    const reach = attrs.placement === 'center' ? 2 : 1

    const onMove = (move: PointerEvent) => {
      const delta = ((move.clientX - startX) * direction * reach * 100) / column
      updateAttributes({ widthPct: Math.round(clamp(startPct + delta, MIN_WIDTH_PCT, 100)) })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <NodeViewWrapper
      as="figure"
      className={cx('bk-ill', editable && 'is-editable', selected && 'is-selected')}
      data-placement={attrs.placement}
      style={{ width: `${attrs.widthPct}%` }}
    >
      <div className="bk-ill-frame" style={{ aspectRatio: String(attrs.aspect) }} data-drag-handle>
        {attrs.src ? (
          <img src={attrs.src} alt={attrs.prompt} draggable={false} />
        ) : (
          <div className="bk-ill-empty">Illustration</div>
        )}
        {attrs.status === 'generating' && (
          <div className="bk-ill-busy">
            <Spinner className="size-5" />
          </div>
        )}
        {attrs.status === 'error' && <div className="bk-ill-busy">Could not be drawn</div>}
      </div>
      {attrs.caption && <figcaption>{attrs.caption}</figcaption>}
      {resizable && (
        <span
          role="presentation"
          className="bk-ill-handle"
          data-side={attrs.placement === 'right' ? 'left' : 'right'}
          onPointerDown={startResize}
        />
      )}
    </NodeViewWrapper>
  )
}

export const Illustration = Node.create({
  name: 'illustration',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    // The figure markup is built from the node below, so attributes are not rendered one by one.
    return Object.fromEntries(
      Object.entries(DEFAULTS).map(([name, value]) => [name, { default: value, rendered: false }]),
    )
  },

  parseHTML() {
    return [{ tag: 'figure.bk-ill' }]
  },

  renderHTML({ node }) {
    const attrs = node.attrs as IllustrationAttrs
    const picture: DOMOutputSpec = attrs.src
      ? ['img', { src: attrs.src, alt: attrs.prompt }]
      : ['div', { class: 'bk-ill-empty' }, 'Illustration']
    const figure: [string, Record<string, string>, ...DOMOutputSpec[]] = [
      'figure',
      { class: 'bk-ill', 'data-placement': attrs.placement, style: `width:${attrs.widthPct}%` },
      ['div', { class: 'bk-ill-frame', style: `aspect-ratio:${attrs.aspect}` }, picture],
    ]
    if (attrs.caption) figure.push(['figcaption', {}, attrs.caption])
    return figure
  },

  addNodeView() {
    return ReactNodeViewRenderer(IllustrationView)
  },
})
