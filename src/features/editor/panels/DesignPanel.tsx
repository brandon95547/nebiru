import { RefreshCw } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { StylePicker } from '@/components/StylePicker'
import { Button } from '@/components/ui/Button'
import { Field, Input, Segmented, Select } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Overlay'
import { BODY_FONTS, HEADING_FONTS, TRIM_SIZES } from '@/lib/bookFormats'
import { clamp } from '@/lib/util'
import { generateCover, restyleInterior, useJobs } from '@/services/generation'
import { patchBook, updateBook } from '@/store/library'
import type { Book, PageMargins, PageSettings } from '@/types'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line p-4">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      {children}
    </section>
  )
}

const MARGIN_LABELS: Array<[keyof PageMargins, string]> = [
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['inside', 'Inside'],
  ['outside', 'Outside'],
]

interface NumberFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function NumberField({ label, value, min, max, step, onChange }: NumberFieldProps) {
  return (
    <Field label={label}>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = event.target.valueAsNumber
          if (Number.isFinite(next)) onChange(clamp(next, min, max))
        }}
        className="h-9 text-sm"
      />
    </Field>
  )
}

export function DesignPanel({ book }: { book: Book }) {
  const { page } = book
  const [redrawing, setRedrawing] = useState<'interior' | 'cover' | null>(null)
  const coverFailure = useJobs((state) => state.pictureErrors[book.id])

  const setPage = (patch: Partial<PageSettings>) =>
    updateBook(book.id, (current) => ({ ...current, page: { ...current.page, ...patch } }))

  const redraw = async (target: 'interior' | 'cover') => {
    setRedrawing(target)
    try {
      await (target === 'interior' ? restyleInterior(book.id) : generateCover(book.id))
    } finally {
      setRedrawing(null)
    }
  }

  return (
    <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
      <Group title="Page">
        <Field label="Pages" hint={page.theme === 'dark' ? 'Dark pages suit the screen. Choose light for printing.' : undefined}>
          <Segmented
            label="Page colour"
            value={page.theme}
            onChange={(theme) => setPage({ theme })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Field>
        <Field label="Trim size">
          <Select
            value={page.trimId}
            onChange={(event) => {
              const trim = TRIM_SIZES.find((size) => size.id === event.target.value)
              if (trim) setPage({ trimId: trim.id, widthIn: trim.widthIn, heightIn: trim.heightIn })
            }}
            className="h-9 text-sm"
          >
            {TRIM_SIZES.map((size) => (
              <option key={size.id} value={size.id}>
                {size.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {MARGIN_LABELS.map(([side, label]) => (
            <NumberField
              key={side}
              label={`${label} margin (in)`}
              value={page.margins[side]}
              min={0.25}
              max={2}
              step={0.05}
              onChange={(value) => setPage({ margins: { ...page.margins, [side]: value } })}
            />
          ))}
        </div>
      </Group>

      <Group title="Typography">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Body font">
            <Select value={page.bodyFont} onChange={(event) => setPage({ bodyFont: event.target.value })} className="h-9 text-sm">
              {BODY_FONTS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Heading font">
            <Select value={page.headingFont} onChange={(event) => setPage({ headingFont: event.target.value })} className="h-9 text-sm">
              {HEADING_FONTS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </Select>
          </Field>
          <NumberField label="Size (pt)" value={page.fontSizePt} min={8} max={18} step={0.5} onChange={(fontSizePt) => setPage({ fontSizePt })} />
          <NumberField label="Line spacing" value={page.lineHeight} min={1.1} max={2} step={0.05} onChange={(lineHeight) => setPage({ lineHeight })} />
        </div>
        <Field label="Paragraphs">
          <Segmented
            label="Paragraph style"
            value={page.paragraphStyle}
            onChange={(paragraphStyle) => setPage({ paragraphStyle })}
            options={[
              { value: 'indent', label: 'Indented' },
              { value: 'spaced', label: 'Spaced' },
            ]}
          />
        </Field>
        <Field label="Alignment">
          <Segmented
            label="Text alignment"
            value={page.justify ? 'justify' : 'left'}
            onChange={(value) => setPage({ justify: value === 'justify' })}
            options={[
              { value: 'justify', label: 'Justified' },
              { value: 'left', label: 'Left' },
            ]}
          />
        </Field>
      </Group>

      <Group title={book.kind === 'page' ? 'Illustrations' : 'Interior illustrations'}>
        <StylePicker
          compact
          label="Interior illustration style"
          value={book.interiorStyle}
          onChange={(interiorStyle) => patchBook(book.id, { interiorStyle })}
        />
        <Button variant="secondary" size="sm" className="w-full" disabled={redrawing !== null} onClick={() => void redraw('interior')}>
          {redrawing === 'interior' ? <Spinner /> : <RefreshCw className="size-4" />}
          Redraw all in this style
        </Button>
      </Group>

      {book.kind !== 'page' && (
      <Group title="Front cover">
        <StylePicker
          compact
          label="Cover illustration style"
          value={book.coverStyle}
          onChange={(coverStyle) => patchBook(book.id, { coverStyle })}
        />
        <Button variant="secondary" size="sm" className="w-full" disabled={redrawing !== null} onClick={() => void redraw('cover')}>
          {redrawing === 'cover' ? <Spinner /> : <RefreshCw className="size-4" />}
          Redraw the cover
        </Button>
        {book.cover.status === 'error' && (
          <p role="alert" className="text-sm text-red-300">
            {coverFailure ?? 'The cover could not be drawn.'}
          </p>
        )}
      </Group>
      )}
    </div>
  )
}
