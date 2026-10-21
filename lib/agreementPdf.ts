/**
 * AN AGREEMENT AS A PDF, in the browser, with no dependency.
 *
 * The "Download PDF" button on the condensed agreement box
 * (app/components/CxAgreementBox.tsx, used by /onboard/[token] and the in-app
 * LiabilityGate) calls this. It is a copy of crmbuilds shared/agreement-pdf.ts:
 * a minimal PDF 1.4 writer (Letter pages, the two built-in Helvetica faces so
 * nothing is embedded, word wrap from the standard Helvetica widths, WinAnsi
 * escaping) that returns bytes, so it runs on a public page with no login and
 * no server round trip.
 *
 * Why no library: pdfkit in this repo is server-only (Node streams + fs fonts).
 * jsPDF or pdf-lib would add 100-350 KB to the client bundle for a text-only
 * document this small writer already draws.
 *
 * It draws the EXACT text it is given. It never rewords, trims or reorders:
 * only characters WinAnsi Helvetica cannot draw are folded (curly quotes to
 * straight, dashes to "-").
 */

export type AgreementPdfBlock =
  | { kind: "h1" | "h2" | "h3" | "p"; text: string }
  | { kind: "ul"; items: string[] };

export interface AgreementPdfInput {
  /** The agreement's title, e.g. "Services Agreement". */
  title: string;
  /** The version the page records (a constant, a policy version, or a content hash). */
  version?: string | null;
  /** Who the agreement is with, e.g. "Suite CXO". */
  entity: string;
  /** The date printed in the header; defaults to today. */
  date?: Date;
  /** Extra header lines (e.g. "Content hash: ..."), drawn small and grey. */
  meta?: string[];
  blocks: AgreementPdfBlock[];
}

// Helvetica advance widths (1/1000 em) for ASCII 32..126, from the Adobe AFM.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Fold text to what WinAnsi Helvetica can draw (same folds as the server copy). */
export function agreementPdfSafeText(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/[•·]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[^\x20-\x7E¡-ÿ]/g, "?");
}

function charWidth(ch: string, bold: boolean): number {
  const c = ch.charCodeAt(0);
  const w = c >= 32 && c <= 126 ? HELV[c - 32] : 556;
  return bold ? w * 1.06 : w;
}

function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch, bold);
  return (w * size) / 1000;
}

/** Greedy word wrap; a word longer than the line is split by characters. */
export function agreementPdfWrap(s: string, size: number, maxWidth: number, bold = false): string[] {
  const words = agreementPdfSafeText(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let word of words) {
    while (textWidth(word, size, bold) > maxWidth) {
      let cut = word.length - 1;
      while (cut > 1 && textWidth(word.slice(0, cut), size, bold) > maxWidth) cut--;
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const next = cur ? `${cur} ${word}` : word;
    if (textWidth(next, size, bold) <= maxWidth) cur = next;
    else { if (cur) lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function pdfStr(s: string): string {
  let out = "";
  for (const ch of agreementPdfSafeText(s)) {
    const c = ch.charCodeAt(0);
    if (ch === "\\" || ch === "(" || ch === ")") out += `\\${ch}`;
    else if (c > 126) out += `\\${c.toString(8).padStart(3, "0")}`;
    else out += ch;
  }
  return `(${out})`;
}

/** Plain legal text to blocks: blank lines split paragraphs, "- " lines are bullets,
 *  "# " / "## " lines are headings. Every word is kept. */
export function textToAgreementBlocks(text: string): AgreementPdfBlock[] {
  const blocks: AgreementPdfBlock[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => { if (para.length) blocks.push({ kind: "p", text: para.join(" ") }); para = []; };
  const flushList = () => { if (list.length) blocks.push({ kind: "ul", items: list }); list = []; };
  for (const raw of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    if (line.startsWith("## ")) { flushPara(); flushList(); blocks.push({ kind: "h2", text: line.slice(3).trim() }); }
    else if (line.startsWith("# ")) { flushPara(); flushList(); blocks.push({ kind: "h1", text: line.slice(2).trim() }); }
    else if (/^[-•]\s/.test(line)) { flushPara(); list.push(line.replace(/^[-•]\s+/, "")); }
    else { flushList(); para.push(line); }
  }
  flushPara();
  flushList();
  return blocks;
}

export function agreementPdfDate(d: Date = new Date()): string {
  try {
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** A file name from the title and version, e.g. "services-agreement-v3.pdf". */
export function agreementPdfFilename(title: string, version?: string | null): string {
  const slug = (s: string) => agreementPdfSafeText(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const base = slug(title).slice(0, 60) || "agreement";
  const v = version ? slug(String(version)).slice(0, 20) : "";
  return `${base}${v ? `-v${v.replace(/^v-?/, "")}` : ""}.pdf`;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = PAGE_H - MARGIN;
const BOTTOM = MARGIN + 28;

type Op = { font: "R" | "B"; size: number; x: number; y: number; text: string; gray?: boolean };
type Rule = { x1: number; y: number; x2: number };

/** The PDF bytes. Every char of the serialised file is one latin1 byte. */
export function buildAgreementPdf(input: AgreementPdfInput): Uint8Array {
  const pages: { ops: Op[]; rules: Rule[] }[] = [];
  let page = { ops: [] as Op[], rules: [] as Rule[] };
  pages.push(page);
  let y = TOP;

  const newPage = () => { page = { ops: [], rules: [] }; pages.push(page); y = TOP; };
  const ensure = (h: number) => { if (y - h < BOTTOM) newPage(); };
  const line = (text: string, font: "R" | "B", size: number, x = MARGIN, gray = false) => {
    const lh = size * 1.45;
    ensure(lh);
    y -= lh;
    page.ops.push({ font, size, x, y, text, gray });
  };
  const para = (text: string, font: "R" | "B", size: number, indent = 0, gray = false) => {
    for (const l of agreementPdfWrap(text, size, CONTENT_W - indent, font === "B")) line(l, font, size, MARGIN + indent, gray);
  };
  const gap = (h: number) => { y -= h; };

  // Header: entity, title, version + date, extra meta, then a rule.
  line(input.entity.toUpperCase(), "B", 9, MARGIN, true);
  gap(4);
  para(input.title, "B", 18);
  gap(2);
  const sub = [input.version ? `Version ${input.version}` : "", agreementPdfDate(input.date)].filter(Boolean).join("  |  ");
  para(sub, "R", 9.5, 0, true);
  for (const m of input.meta ?? []) para(m, "R", 9, 0, true);
  gap(8);
  page.rules.push({ x1: MARGIN, y, x2: PAGE_W - MARGIN });
  gap(6);

  for (const b of input.blocks) {
    if (b.kind === "ul") {
      for (const item of b.items) {
        const wrapped = agreementPdfWrap(item, 10.5, CONTENT_W - 14);
        wrapped.forEach((l, i) => {
          line(l, "R", 10.5, MARGIN + 14);
          if (i === 0) page.ops.push({ font: "R", size: 10.5, x: MARGIN + 3, y, text: "-" });
        });
      }
      gap(5);
    }
    else if (b.kind === "h1") { gap(8); ensure(44); para(b.text, "B", 15); gap(4); }
    else if (b.kind === "h2") { gap(10); ensure(40); para(b.text, "B", 12); gap(2); }
    else if (b.kind === "h3") { gap(6); ensure(34); para(b.text, "B", 10.5); gap(1); }
    else { para(b.text, "R", 10.5); gap(5); }
  }

  // Serialise.
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalogId = add("");
  const pagesId = add("");
  const fontR = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontB = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  const total = pages.length;
  const footBase = [input.title, input.version ? `Version ${input.version}` : ""].filter(Boolean).join("  |  ");
  pages.forEach((p, i) => {
    let content = "";
    for (const r of p.rules) content += `0.8 G 0.75 w ${r.x1} ${r.y.toFixed(2)} m ${r.x2} ${r.y.toFixed(2)} l S\n`;
    for (const o of p.ops) {
      content += `BT ${o.gray ? "0.42 g" : "0.11 g"} /F${o.font} ${o.size} Tf ${o.x.toFixed(2)} ${o.y.toFixed(2)} Td ${pdfStr(o.text)} Tj ET\n`;
    }
    const footer = `${footBase}  |  Page ${i + 1} of ${total}`;
    content += `BT 0.42 g /FR 8 Tf ${MARGIN} ${MARGIN - 4} Td ${pdfStr(footer.length > 110 ? `${footer.slice(0, 107)}...` : footer)} Tj ET\n`;
    const streamId = add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /FR ${fontR} 0 R /FB ${fontB} 0 R >> >> /Contents ${streamId} 0 R >>`));
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const infoId = add(`<< /Title ${pdfStr(input.title)} /Author ${pdfStr(input.entity)} /Producer (Suite CXO agreement download) >>`);

  // Content is pure ASCII after pdfStr's octal escapes, so string length == byte length.
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
