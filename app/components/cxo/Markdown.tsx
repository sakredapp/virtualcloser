/**
 * Renders markdown (lib/markdown.ts) as React elements. No HTML string is
 * ever built or injected: a <script> in the source shows up as text. Works
 * in server and client components (no hooks).
 */
import { Fragment, type ReactNode } from 'react'
import { parseMarkdown, type Inline, type ListItem } from '@/lib/markdown'

function renderInline(nodes: Inline[], key: string): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}.${i}`
    switch (n.t) {
      case 'text': return <Fragment key={k}>{n.v}</Fragment>
      case 'bold': return <strong key={k}>{renderInline(n.v, k)}</strong>
      case 'italic': return <em key={k}>{renderInline(n.v, k)}</em>
      case 'code': return <code key={k}>{n.v}</code>
      case 'link': return <a key={k} href={n.href} target="_blank" rel="noreferrer noopener">{n.v}</a>
    }
  })
}

function lines(ls: Inline[][], key: string): ReactNode[] {
  return ls.flatMap((l, i) => (i ? [<br key={`${key}br${i}`} />, ...renderInline(l, `${key}l${i}`)] : renderInline(l, `${key}l${i}`)))
}

function Item({ it, k }: { it: ListItem; k: string }) {
  if (it.task) {
    return (
      <li className="cx-md-task" data-done={it.task === 'done' ? '' : undefined} data-depth={it.depth || undefined}>
        <input type="checkbox" checked={it.task === 'done'} readOnly disabled aria-label={it.task === 'done' ? 'Done' : 'Not done'} />
        <span>{renderInline(it.text, k)}</span>
      </li>
    )
  }
  return <li data-depth={it.depth || undefined}>{renderInline(it.text, k)}</li>
}

export default function Markdown({ text, className }: { text: string; className?: string }) {
  const out = parseMarkdown(text).map((b, bi) => {
    const k = `b${bi}`
    switch (b.t) {
      case 'heading':
        return <p key={k} className="cx-md-h" role="heading" aria-level={Math.min(6, b.level + 2)} data-level={b.level}>{renderInline(b.text, k)}</p>
      case 'para':
        return <p key={k}>{lines(b.lines, k)}</p>
      case 'quote':
        return <blockquote key={k} className="cx-md-quote">{lines(b.lines, k)}</blockquote>
      case 'rule':
        return <hr key={k} className="cx-md-rule" />
      case 'list': {
        const items = b.items.map((it, i) => <Item key={i} it={it} k={`${k}i${i}`} />)
        const tasks = b.items.some((it) => it.task)
        return b.ordered
          ? <ol key={k}>{items}</ol>
          : <ul key={k} className={tasks ? 'cx-md-tasks' : undefined}>{items}</ul>
      }
      case 'table':
        return (
          <div key={k} className="cx-md-table">
            <table>
              <thead><tr>{b.head.map((c, ci) => <th key={ci}>{renderInline(c, `${k}h${ci}`)}</th>)}</tr></thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInline(c, `${k}r${ri}c${ci}`)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )
    }
  })
  return className ? <div className={className}>{out}</div> : <>{out}</>
}
