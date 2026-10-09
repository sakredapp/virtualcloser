'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The app's own ask/confirm modal — replaces window.prompt() and window.confirm()
 * on the CXO pages. Cream/white surface, Lora title, Cancel + one red action.
 * Enter submits, Esc closes, focus lands in the input (or on the action).
 *
 *   const dialog = useDialog()
 *   const name = await dialog.ask({ title: 'New board', label: 'Board name', confirmLabel: 'Create board' })
 *   if (await dialog.confirm({ title: 'Delete card?', confirmLabel: 'Delete' })) …
 */

type AskOpts = { title: string; label?: string; body?: ReactNode; placeholder?: string; initial?: string; confirmLabel?: string }
type ConfirmOpts = { title: string; body?: ReactNode; confirmLabel?: string }
type Open =
  | ({ kind: 'ask'; resolve: (v: string | null) => void } & AskOpts)
  | ({ kind: 'confirm'; resolve: (v: boolean) => void } & ConfirmOpts)

type DialogApi = { ask: (o: AskOpts) => Promise<string | null>; confirm: (o: ConfirmOpts) => Promise<boolean> }

const Ctx = createContext<DialogApi | null>(null)

export function DialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null)
  const ask = useCallback((o: AskOpts) => new Promise<string | null>((resolve) => setOpen({ kind: 'ask', resolve, ...o })), [])
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setOpen({ kind: 'confirm', resolve, ...o })), [])
  return (
    <Ctx.Provider value={{ ask, confirm }}>
      {children}
      {open && <Dialog open={open} onDone={() => setOpen(null)} />}
    </Ctx.Provider>
  )
}

export function useDialog(): DialogApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('useDialog needs a <DialogProvider> above it')
  return api
}

function Dialog({ open, onDone }: { open: Open; onDone: () => void }) {
  const [value, setValue] = useState(open.kind === 'ask' ? open.initial ?? '' : '')
  const inputRef = useRef<HTMLInputElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)

  const cancel = useCallback(() => {
    if (open.kind === 'ask') open.resolve(null)
    else open.resolve(false)
    onDone()
  }, [open, onDone])
  const submit = () => {
    if (open.kind === 'ask') {
      if (!value.trim()) return
      open.resolve(value.trim())
    } else open.resolve(true)
    onDone()
  }

  useEffect(() => {
    if (open.kind === 'ask') {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else actionRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, cancel])

  return (
    <div className="cx-dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <form
        className="cx-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cx-dialog-title"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <h2 id="cx-dialog-title">{open.title}</h2>
        {open.body && <div className="cx-dialog-body">{open.body}</div>}
        {open.kind === 'ask' && (
          <label className="cx-dialog-field">
            {open.label && <span>{open.label}</span>}
            <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} placeholder={open.placeholder} maxLength={120} />
          </label>
        )}
        <footer>
          <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={cancel}>Cancel</button>
          <button ref={actionRef} type="submit" className="cx-btn cx-btn-sm" disabled={open.kind === 'ask' && !value.trim()}>
            {open.confirmLabel || 'OK'}
          </button>
        </footer>
      </form>
    </div>
  )
}
