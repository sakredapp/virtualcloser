/**
 * The ONE stat row (report-kit StatRow + StatTile, stat-tile.css) and the
 * CIAO side chat's height cap. Nick 2026-10-21: every row of figures lines
 * up (labels on one top line, figures one size on one baseline, the empty
 * state in the figure's slot, the sub line reserved for the whole row,
 * equal columns, 4 -> 2x2 when the panel is narrow, a stack on a phone), and
 * the side chat is never taller than the content panel beside it.
 * Mirrors crmbuilds #3942 (stat rows). Made-up figures only.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CxStatTile, StatRow, StatTile, isEmptyFigure, statRowCols } from '@/app/components/cxo/report-kit'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const css = read('app/components/cxo/stat-tile.css')
const dock = read('app/components/cxo/mira-bar.css')
const globals = read('app/globals.css')

const html = (...tiles: ReturnType<typeof createElement>[]) =>
  renderToStaticMarkup(createElement(StatRow, { look: 'cx', cols: 4, testId: 'r' }, ...tiles))

describe('StatTile slots', () => {
  it('draws label, figure and sub in fixed slots, in that order', () => {
    const out = html(createElement(CxStatTile, { label: 'Revenue, 12 months', value: '$1.2M', sub: 'Made-up sub' }))
    const iLabel = out.indexOf('cx-stat-label')
    const iValue = out.indexOf('cx-stat-value')
    const iSub = out.indexOf('cx-stat-sub')
    expect(iLabel).toBeGreaterThan(-1)
    expect(iValue).toBeGreaterThan(iLabel)
    expect(iSub).toBeGreaterThan(iValue)
    expect(out).toContain('cx-eyebrow')
    expect(out).toContain('cx-kpi-figure')
    expect(out).toContain('cx-kpi-sub')
    expect(out).toContain('title="Revenue, 12 months"')
  })

  it('wraps the row in a container so it re-flows on the panel width, not the viewport', () => {
    const out = html(createElement(CxStatTile, { label: 'A', value: '1' }))
    expect(out.startsWith('<div class="cx-stat-wrap">')).toBe(true)
    expect(out).toContain('data-look="cx"')
    expect(out).toContain('--cx-stat-cols-wide:4')
    expect(out).toContain('--cx-stat-cols-mid:2')
    expect(out).toContain('--cx-stat-cols-narrow:2')
  })

  it('puts extras (bars, sparks, scope) after the aligned block', () => {
    const out = renderToStaticMarkup(
      createElement(StatTile, { label: 'A', value: '1', children: createElement('i', { className: 'extra' }) }),
    )
    expect(out.indexOf('class="extra"')).toBeGreaterThan(out.indexOf('cx-stat-sub'))
  })

  it('keeps an (i) tip beside the label, outside the ellipsised text', () => {
    const out = renderToStaticMarkup(createElement(StatTile, { label: 'Past month 10', labelAside: createElement('span', { className: 'cx-info' }) }))
    expect(out).toMatch(/<span class="cx-stat-label-text">Past month 10<\/span><span class="cx-info">/)
  })
})

describe('empty state', () => {
  it('treats nothing and a bare dash as empty', () => {
    for (const v of [null, undefined, '', '—', '-', '–']) expect(isEmptyFigure(v)).toBe(true)
    for (const v of [0, '0', '$0', '0%']) expect(isEmptyFigure(v)).toBe(false)
  })
  it('draws "No data yet" in the figure slot', () => {
    for (const value of [null, '—']) {
      const out = renderToStaticMarkup(createElement(StatTile, { label: 'Pace', value }))
      expect(out).toMatch(/class="cx-stat-value"[^>]*><span class="cx-stat-empty">No data yet<\/span>/)
    }
  })
  it('a zero is a figure, not an empty state', () => {
    const out = renderToStaticMarkup(createElement(StatTile, { label: 'Days', value: 0 }))
    expect(out).not.toContain('No data yet')
    expect(out).toContain('<span class="cx-stat-value-text">0</span>')
  })
  it('takes a custom empty text', () => {
    const out = renderToStaticMarkup(createElement(StatTile, { label: 'Profit', value: null, empty: 'Not started' }))
    expect(out).toContain('Not started')
  })
})

describe('reserved sub slot', () => {
  it('always renders the sub div, marked empty when the tile has none', () => {
    const out = html(
      createElement(CxStatTile, { key: 'a', label: 'A', value: '1' }),
      createElement(CxStatTile, { key: 'b', label: 'B', value: '2', sub: 'only this one' }),
    )
    expect(out.match(/cx-stat-sub/g)?.length).toBe(2)
    expect(out.match(/data-empty=""[^>]*> </g)?.length).toBe(1)
  })
  it('CSS keeps the empty sub line on every tile once any tile in the row has one', () => {
    expect(css).toContain('.cx-stat-sub[data-empty] { display: none; }')
    expect(css).toMatch(/\.cx-stat-row:has\(\.cx-stat-sub:not\(\[data-empty\]\)\) \.cx-stat-sub\[data-empty\] \{ display: block; visibility: hidden; \}/)
    expect(css).toMatch(/\.cx-stat-row\[data-reserve-sub\] \.cx-stat-sub\[data-empty\]/)
  })
  it('reserveSub forces the line even when no tile has one', () => {
    const out = renderToStaticMarkup(createElement(StatRow, { reserveSub: true }, createElement(StatTile, { label: 'A', value: '1' })))
    expect(out).toContain('data-reserve-sub=""')
  })
})

describe('one line, one size per row', () => {
  it('label, figure and sub are each one fixed line', () => {
    expect(css).toMatch(/\.cx-stat-label \{[^}]*height: 1\.4em;[^}]*white-space: nowrap;/s)
    expect(css).toMatch(/\.cx-stat-value \{[^}]*white-space: nowrap;[^}]*height: 1lh;/s)
    expect(css).toMatch(/\.cx-stat-sub \{[^}]*white-space: nowrap;[^}]*height: 1\.45em;/s)
  })
  it('the figure size comes from the row (one --cx-stat-max), shrinking to fit its column', () => {
    expect(css).toMatch(/font-size: clamp\(13px, calc\(100cqi \/ \(var\(--cx-stat-fit-chars, 7\) \* 0\.6\)\), var\(--cx-stat-max, 30px\)\)/)
    // beats the per-surface overrides (.cx-stat .cx-kpi-figure 32px, .cx-qbo-kpis 24px ...)
    expect(css).toContain('.cx-stat-row .cx-stat-tile .cx-stat-value {')
  })
})

describe('columns', () => {
  it('equal columns from the row vars', () => {
    expect(css).toMatch(/grid-template-columns: repeat\(var\(--cx-stat-cols-wide, 4\), minmax\(0, 1fr\)\)/)
  })
  it('four become 2x2 on a narrow panel (container query), then stack', () => {
    expect(css).toContain('.cx-stat-wrap { container: cxstat / inline-size;')
    expect(css).toMatch(/@container cxstat \(max-width: 440px\) \{\s*\.cx-stat-row \{ grid-template-columns: repeat\(var\(--cx-stat-cols-narrow, 2\), minmax\(0, 1fr\)\); \}/)
    expect(css).toMatch(/@container cxstat \(max-width: 340px\) \{\s*\.cx-stat-row:not\(\[data-no-stack\]\) \{ grid-template-columns: minmax\(0, 1fr\); \}/)
    expect(css).not.toMatch(/@media[^{]*\{\s*\.cx-stat-row/)
    expect(statRowCols(4)).toEqual({ wide: 4, mid: 2, narrow: 2 })
    expect(statRowCols(6)).toEqual({ wide: 6, mid: 3, narrow: 2 })
    expect(statRowCols(3)).toEqual({ wide: 3, mid: 3, narrow: 1 })
  })
})

describe('side chat never taller than the content panel', () => {
  it('the shell geometry the dock is pinned to is unchanged', () => {
    expect(globals).toMatch(/\.dash-shell \{\s*display: flex;\s*gap: 20px;\s*padding: 20px 20px 28px;/)
    expect(globals).toContain('min-height: calc(100vh - 48px);')
    expect(globals).toContain('padding-top: calc(20px + var(--cx-topbar-h, 0px));')
  })
  it('wide: top/bottom/right sit on the shell padding, and the panel gives up the width', () => {
    const wide = dock.slice(dock.indexOf('@media (min-width: 1100px)'), dock.indexOf('.cx-dock__scrim { display: none; }'))
    expect(wide).toContain('top: calc(20px + var(--cx-topbar-h, 0px));')
    expect(wide).toContain('bottom: 28px;')
    expect(wide).toContain('right: 20px;')
    expect(wide).toContain('max-height: calc(100vh - 48px - var(--cx-topbar-h, 0px));')
    expect(wide).toContain('.dash-main:has(> .cx-dock > .cx-dock__ans) { margin-right: 400px; }')
    expect(dock).not.toContain('padding-right: 412px')
  })
  it('the panel clips and the messages scroll inside it', () => {
    expect(dock).toMatch(/\.cx-dock:has\(> \.cx-dock__ans\) \{[^}]*overflow: hidden;/s)
    expect(dock).toMatch(/\.cx-dock:has\(> \.cx-dock__ans\) \.cx-dock__ans \{[^}]*flex: 1;\s*min-height: 0;/s)
    expect(dock).toMatch(/\.cx-dock__body \{[^}]*min-height: 0;[^}]*overflow-y: auto;/s)
  })
  it('narrow: same shell insets (20 / 28 above 860px, 12 below)', () => {
    const mid = dock.slice(dock.indexOf('@media (max-width: 1099px)'), dock.indexOf('@media (max-width: 860px)'))
    expect(mid).toContain('top: calc(20px + var(--cx-topbar-h, 0px));')
    expect(mid).toContain('bottom: 28px;')
    const small = dock.slice(dock.indexOf('@media (max-width: 860px)'), dock.indexOf("/* Markdown in Mira's answer */"))
    expect(small).toContain('top: calc(12px + var(--cx-topbar-h, 0px));')
    expect(small).toContain('bottom: 12px;')
  })
})

describe('ratchet: swept surfaces draw their figure rows with the shared row', () => {
  const swept = [
    'app/components/cxo/ExecOverview.tsx',
    'app/components/cxo/TeamPeople.tsx',
    'app/components/cxo/TeamRetention.tsx',
    'app/components/cxo/QboPanel.tsx',
    'app/components/cxo/AdoptionView.tsx',
    'app/dashboard/plan/CompPanels.tsx',
    'app/dashboard/plan/PlanVisuals.tsx',
    'app/dashboard/employees/EmployeesClient.tsx',
  ]
  // Single hero figures, not rows: the month hero, Placement, unit economics, the forecast.
  const singleFigures: Record<string, number> = {
    'app/components/cxo/ExecOverview.tsx': 1,
    'app/dashboard/plan/PlanVisuals.tsx': 1,
  }
  for (const f of swept) {
    it(`${f} imports StatRow from report-kit and has no hand-made figure grid`, () => {
      const src = read(f)
      expect(src).toMatch(/import \{[^}]*\bStatRow\b[^}]*\} from '(\.\/report-kit|@\/app\/components\/cxo\/report-kit)'/)
      expect(src).toContain('<StatRow')
      expect(src).not.toMatch(/<div className="(cx-grid cx-grid-[46]|cx-grid-[46]|cx-retention-figs|cx-adopt-figs|cxu-kpis|cx-stat-pair)\b/)
      expect((src.match(/className="cx-kpi-figure"/g) ?? []).length).toBeLessThanOrEqual(singleFigures[f] ?? 0)
    })
  }
  it('report-kit loads the shared CSS', () => {
    expect(read('app/components/cxo/report-kit.tsx')).toContain("import './stat-tile.css'")
  })
})
