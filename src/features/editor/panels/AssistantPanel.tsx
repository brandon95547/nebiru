import { Expand, type LucideIcon, PenLine, Send, Shrink, SpellCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Select, Textarea } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Overlay'
import { docText } from '@/lib/doc'
import { cx, uid } from '@/lib/util'
import { services } from '@/services'
import { briefOf } from '@/services/generation'
import type { RevisionAction } from '@/services/text/types'
import { useEditorHub } from '@/store/editorHub'
import { updateBook } from '@/store/library'
import type { Book, ChatMessage } from '@/types'
import { reviseSelection } from '../actions'

const ACTIONS: Array<{ action: RevisionAction; label: string; icon: LucideIcon }> = [
  { action: 'grammar', label: 'Fix grammar', icon: SpellCheck },
  { action: 'rewrite', label: 'Rewrite', icon: PenLine },
  { action: 'expand', label: 'Expand', icon: Expand },
  { action: 'shorten', label: 'Shorten', icon: Shrink },
]

const STYLES = ['Formal', 'Conversational', 'Simple and clear', 'Poetic', 'Dramatic', 'Humorous']

function appendChat(bookId: string, message: ChatMessage): void {
  updateBook(bookId, (book) => ({ ...book, chat: [...book.chat, message] }))
}

export function AssistantPanel({ book }: { book: Book }) {
  const activeChapterId = useEditorHub((state) => state.activeChapterId)
  const activeChapter = book.chapters.find((chapter) => chapter.id === activeChapterId)
  const [working, setWorking] = useState<RevisionAction | null>(null)
  const [style, setStyle] = useState(STYLES[0])
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState('')
  const [replying, setReplying] = useState(false)
  const threadEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }, [book.chat.length, replying])

  const revise = async (action: RevisionAction) => {
    setWorking(action)
    setNote('')
    try {
      const outcome = await reviseSelection(book, action, action === 'style' ? style : undefined)
      setNote(outcome.note ?? (outcome.changed > 0 ? 'Done. Undo brings the original back.' : 'Nothing needed changing.'))
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That did not work. Try again.')
    } finally {
      setWorking(null)
    }
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || replying) return
    setDraft('')
    const message: ChatMessage = { id: uid('msg'), role: 'user', text }
    appendChat(book.id, message)
    setReplying(true)
    try {
      const { reply } = await services.text.chat({
        brief: briefOf(book),
        messages: [...book.chat, message],
        chapterTitle: activeChapter?.title,
        chapterText: activeChapter ? docText(activeChapter.content) : undefined,
      })
      appendChat(book.id, { id: uid('msg'), role: 'assistant', text: reply })
    } catch (error) {
      const reply = error instanceof Error ? error.message : 'The assistant could not answer. Try again.'
      appendChat(book.id, { id: uid('msg'), role: 'assistant', text: reply })
    } finally {
      setReplying(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="border-b border-line p-4">
        <h3 className="text-sm font-medium text-ink">Revise text</h3>
        <p className="mt-1 text-sm text-ink-mute">Works on your selection, or the paragraph your cursor is in.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {ACTIONS.map(({ action, label, icon: Icon }) => (
            <Button
              key={action}
              variant="secondary"
              size="sm"
              disabled={working !== null}
              onClick={() => void revise(action)}
              className="justify-start"
            >
              {working === action ? <Spinner /> : <Icon className="size-4" />}
              {label}
            </Button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Select
            aria-label="Writing style"
            value={style}
            onChange={(event) => setStyle(event.target.value)}
            className="h-8 min-w-0 flex-1 text-sm"
          >
            {STYLES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" disabled={working !== null} onClick={() => void revise('style')}>
            {working === 'style' && <Spinner />}
            Restyle
          </Button>
        </div>
        {note && (
          <p role="status" className="mt-3 text-sm text-ink-soft">
            {note}
          </p>
        )}
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="scroll-quiet min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {book.chat.length === 0 && (
            <p className="text-sm text-ink-mute">
              Ask about the book or describe a change
              {activeChapter ? `. The assistant can see “${activeChapter.title}”.` : '.'}
            </p>
          )}
          {book.chat.map((message) => (
            <p
              key={message.id}
              className={cx(
                'rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                message.role === 'user' ? 'ml-6 bg-raised text-ink' : 'mr-6 border border-line text-ink-soft',
              )}
            >
              {message.text}
            </p>
          ))}
          {replying && (
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <Spinner /> Thinking…
            </p>
          )}
          <div ref={threadEnd} />
        </div>
        <form
          className="flex items-end gap-2 border-t border-line p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <Textarea
            aria-label="Message the assistant"
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder="Ask or instruct…"
            className="field-sizing-content max-h-40 text-sm"
          />
          <Button type="submit" size="sm" disabled={!draft.trim() || replying} aria-label="Send">
            <Send className="size-4" />
          </Button>
        </form>
      </section>
    </div>
  )
}
