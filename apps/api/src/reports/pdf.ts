import PdfPrinter from "pdfmake";
import type {
  TDocumentDefinitions,
  Content,
  ContentTable,
  StyleDictionary,
} from "pdfmake/interfaces.js";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { product } from "../config.js";

/**
 * PDF generation.
 *
 * Not a bundled browser: that is roughly 300 MB on every image and every
 * Windows installer, for a document a library renders in a few milliseconds.
 * Not hand-drawn either — pdfmake takes a declarative definition and handles
 * the part that actually matters here, which is paginating long tables and
 * repeating their headers.
 *
 * Fonts are the PDF standard 14, built into every reader, so nothing is
 * embedded and nothing extra ships. The trade is WinAnsi encoding: Western
 * European Latin only. `safe()` below keeps that from turning into a crash or
 * a silently wrong character.
 */

const FONTS = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

const printer = new PdfPrinter(FONTS);

/**
 * The wordmark, drawn as vector rather than a raster image so it stays sharp at
 * any zoom and adds almost nothing to the file. Copied into dist at build time
 * from the web package, so the logo has one source.
 *
 * A missing logo must never stop a report being produced — the report is the
 * point, the letterhead is not — so this degrades to the product name in text.
 */
const here = dirname(fileURLToPath(import.meta.url));

function loadLogo(): string | null {
  for (const path of [
    resolve(here, "../brand/logo.svg"),
    resolve(here, "../../../web/src/assets/brand/logo-light-notagline.svg"),
  ]) {
    if (existsSync(path)) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        /* fall through to the next candidate */
      }
    }
  }
  return null;
}

const LOGO = loadLogo();

export const BRAND = "#2457D6";
export const NAVY = "#0B1220";
export const MUTED = "#64748b";
export const LINE = "#e6eaf2";

// ── charts ───────────────────────────────────────────────────────────────────
// Drawn with pdfmake's own shapes, so a report has pictures without a charting
// library or a headless browser on the customer's server.

const TRACK = "#eef2f8";

/** One labelled bar per row, with the figure at the end. */
export function barChart(items: { label: string; pct: number; note: string }[]): Content {
  if (!items.length) return { text: "Nothing to show yet.", style: "small", margin: [0, 2, 0, 8] };
  const W = 190;
  return {
    table: {
      widths: [170, W + 4, "*"],
      body: items.map((i) => {
        const pct = Math.max(0, Math.min(100, i.pct));
        return [
          { text: safe(i.label), style: "td", margin: [0, 3, 6, 3] as [number, number, number, number] },
          {
            canvas: [
              { type: "rect", x: 0, y: 3, w: W, h: 9, r: 3, color: TRACK },
              ...(pct > 0 ? [{ type: "rect" as const, x: 0, y: 3, w: Math.max(4, (W * pct) / 100), h: 9, r: 3, color: BRAND }] : []),
            ],
            margin: [0, 2, 0, 2] as [number, number, number, number],
          },
          { text: safe(i.note), style: "td", margin: [6, 3, 0, 3] as [number, number, number, number] },
        ];
      }),
    },
    layout: "noBorders",
    margin: [0, 2, 0, 8],
  };
}

/** One bar split into parts, with a key underneath. */
export function stackedBar(parts: { label: string; value: number; color: string }[]): Content {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return { text: "Nothing to show yet.", style: "small", margin: [0, 2, 0, 8] };
  const W = 500;
  let x = 0;
  const shapes = parts
    .filter((p) => p.value > 0)
    .map((p) => {
      const w = (W * p.value) / total;
      const shape = { type: "rect" as const, x, y: 0, w, h: 14, color: p.color };
      x += w;
      return shape;
    });
  return {
    stack: [
      { canvas: shapes },
      // The key, four to a row so long names do not squeeze each other.
      {
        table: {
          widths: ["25%", "25%", "25%", "25%"],
          body: Array.from({ length: Math.ceil(parts.length / 4) }, (_, row) =>
            [0, 1, 2, 3].map((col) => {
              const p = parts[row * 4 + col];
              return p
                ? {
                    columns: [
                      { width: 9, canvas: [{ type: "rect" as const, x: 0, y: 2, w: 8, h: 8, r: 2, color: p.color }] },
                      { width: "*", text: safe(`${p.label}  ${p.value}`), style: "small", margin: [3, 0, 6, 0] as [number, number, number, number] },
                    ],
                  }
                : { text: "" };
            })),
        },
        layout: "noBorders",
        margin: [0, 6, 0, 0] as [number, number, number, number],
      },
    ],
    margin: [0, 4, 0, 10],
  };
}

/**
 * The coverage profile: one spoke per theme, clockwise from the top, the
 * shaded shape reaching out as far as each theme has got. Shapes carry no
 * text in pdfmake, so the spokes are numbered by the table beside it.
 */
export function radar(items: { label: string; pct: number }[]): Content {
  if (items.length < 3) return { text: "", margin: [0, 0, 0, 0] };
  const S = 180;
  const c = S / 2;
  const R = 78;
  const n = items.length;
  const at = (i: number, r: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
  };
  const ring = (f: number) => ({
    type: "polyline" as const, closePath: true, lineWidth: 0.6, lineColor: LINE,
    points: items.map((_, i) => at(i, R * f)),
  });
  const spokes = items.map((_, i) => ({
    type: "line" as const, x1: c, y1: c, x2: at(i, R).x, y2: at(i, R).y, lineWidth: 0.5, lineColor: LINE,
  }));
  const shape = {
    type: "polyline" as const, closePath: true, lineWidth: 1.2, lineColor: BRAND, color: BRAND, fillOpacity: 0.18,
    points: items.map((it, i) => at(i, R * Math.max(0.02, Math.min(1, it.pct / 100)))),
  };
  const dots = items.map((it, i) => {
    const p = at(i, R * Math.max(0.02, Math.min(1, it.pct / 100)));
    return { type: "ellipse" as const, x: p.x, y: p.y, r1: 2, r2: 2, color: BRAND };
  });
  return {
    columns: [
      { width: S + 10, canvas: [ring(0.25), ring(0.5), ring(0.75), ring(1), ...spokes, shape, ...dots] },
      {
        width: "*",
        table: {
          widths: [16, "*", 40],
          body: items.map((it, i) => [
            { text: String(i + 1), style: "small", margin: [0, 2, 0, 2] as [number, number, number, number] },
            { text: safe(it.label), style: "td", margin: [0, 2, 0, 2] as [number, number, number, number] },
            { text: `${Math.round(it.pct)}%`, style: "td", alignment: "right", margin: [0, 2, 0, 2] as [number, number, number, number] },
          ]),
        },
        layout: "noBorders",
        margin: [0, 6, 0, 0] as [number, number, number, number],
      },
    ],
    margin: [0, 2, 0, 4],
  };
}

/** Risks placed by likelihood and impact, coloured by score. */
export function heatMap(counts: number[][]): Content {
  const fill = (l: number, i: number) => (l * i >= 20 ? "#fecaca" : l * i >= 12 ? "#fde68a" : "#dcfce7");
  const cell = (text: string, extra: Record<string, unknown> = {}) => ({
    text, style: "td", alignment: "center" as const, margin: [0, 5, 0, 5] as [number, number, number, number], ...extra,
  });
  const body: unknown[][] = [];
  for (let l = 5; l >= 1; l--) {
    body.push([
      cell(String(l), { style: "small" }),
      ...[1, 2, 3, 4, 5].map((i) => {
        const n = counts[l - 1]?.[i - 1] ?? 0;
        return cell(n ? String(n) : "", { fillColor: fill(l, i), bold: n > 0 });
      }),
    ]);
  }
  body.push([cell(""), ...[1, 2, 3, 4, 5].map((i) => cell(String(i), { style: "small" }))]);
  return {
    columns: [
      { width: 52, text: "Likelihood", style: "small", alignment: "right", margin: [0, 50, 4, 0] as [number, number, number, number] },
      {
        width: 280,
        stack: [
          {
            table: { widths: [16, 40, 40, 40, 40, 40], body: body as never },
            layout: { hLineColor: () => "#ffffff", vLineColor: () => "#ffffff", hLineWidth: () => 1.5, vLineWidth: () => 1.5 },
          },
          { text: "Impact", style: "small", alignment: "center", margin: [16, 2, 0, 0] as [number, number, number, number] },
        ],
      },
      {
        width: "*",
        stack: [
          { text: "Red: score 20 or more. Amber: 12 to 19. Green: below 12.", style: "small", margin: [10, 10, 0, 4] as [number, number, number, number] },
          { text: "Open risks, before treatment (likelihood × impact).", style: "small", margin: [10, 0, 0, 0] as [number, number, number, number] },
        ],
      },
    ],
    margin: [0, 2, 0, 10],
  };
}


/**
 * The standard fonts cannot encode outside WinAnsi. Rather than crash on a
 * name with an unusual character, or emit the wrong glyph silently, map the
 * punctuation we actually generate and transliterate the rest to a form a
 * reader can still act on.
 */
export function safe(value: unknown): string {
  const text = value == null ? "" : String(value);
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .normalize("NFKD")
    // Anything still outside Latin-1 becomes a visible marker, never a wrong
    // glyph and never a dropped character: a report that quietly loses text is
    // worse than one that admits it.
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "?");
}

export const styles: StyleDictionary = {
  h1: { fontSize: 20, bold: true, color: NAVY, alignment: "center", margin: [0, 0, 0, 3] },
  h2: { fontSize: 12, bold: true, color: NAVY, margin: [0, 16, 0, 6] },
  lede: { fontSize: 9.5, color: MUTED, alignment: "center", margin: [0, 0, 0, 18] },
  th: { fontSize: 8, bold: true, color: MUTED, fillColor: "#f6f8fc" },
  td: { fontSize: 8.5, color: "#0f172a" },
  small: { fontSize: 8, color: MUTED },
  // Smaller than `small` on purpose: the notice has to be present on every
  // page without competing with the report itself.
  footnote: { fontSize: 7.5, color: MUTED, lineHeight: 1.2 },
  kpiLabel: { fontSize: 7.5, bold: true, color: MUTED },
  kpiValue: { fontSize: 17, bold: true, color: NAVY },
};

/** A row of headline figures, the same four a dashboard would lead with. */
export function kpiRow(items: { label: string; value: string; note?: string }[]): ContentTable {
  return {
    table: {
      widths: items.map(() => "*"),
      body: [
        items.map((k) => ({
          stack: [
            { text: safe(k.label.toUpperCase()), style: "kpiLabel" },
            { text: safe(k.value), style: "kpiValue", margin: [0, 3, 0, 1] as [number, number, number, number] },
            { text: safe(k.note ?? ""), style: "small" },
          ],
          margin: [8, 8, 8, 8] as [number, number, number, number],
        })),
      ],
    },
    layout: {
      hLineColor: () => LINE,
      vLineColor: () => LINE,
      hLineWidth: () => 0.7,
      vLineWidth: () => 0.7,
    },
    margin: [0, 4, 0, 4],
  };
}

/** A table whose header repeats on every page — the point of using a library. */
export function table(
  headers: string[],
  rows: (string | number)[][],
  widths: (string | number)[],
): Content {
  if (rows.length === 0) {
    return { text: "Nothing to report.", style: "small", margin: [0, 4, 0, 8] };
  }
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths,
      body: [
        headers.map((h) => ({ text: safe(h), style: "th", margin: [3, 4, 3, 4] as [number, number, number, number] })),
        ...rows.map((r) =>
          r.map((cell) => ({
            text: safe(cell),
            style: "td",
            margin: [3, 3, 3, 3] as [number, number, number, number],
          })),
        ),
      ],
    },
    layout: {
      hLineColor: () => LINE,
      vLineColor: () => LINE,
      hLineWidth: (i: number) => (i === 1 ? 0.9 : 0.5),
      vLineWidth: () => 0.5,
    },
    margin: [0, 2, 0, 10],
  };
}

export interface DocMeta {
  title: string;
  subtitle: string;
  generatedBy: string;
  /** Printed after the copyright line, when there is one. Usually empty. */
  edition: string;
  /** The framework non-affiliation notice, from the product's pack. */
  disclaimer: string;
  /** Support address, printed under the notice. */
  contact: string;
  landscape?: boolean;
  /** The customer's own logo, when they have set one. */
  clientLogo?: { kind: "image" | "svg"; data: string } | null;
}

/**
 * Two logo sizes, because a report is not one page.
 *
 * The first page carries the logo at letterhead size, in the content, which is
 * where the eye expects it on a document someone hands over. Later pages get a
 * small mark in the running header — repeating a 68pt logo on page seven of a
 * table would cost real space for no benefit.
 *
 * Both are fit boxes, so aspect ratio is always kept: a square mark uses the
 * full height, a wide wordmark the full width, and neither is ever stretched.
 */
const LOGO_LETTERHEAD: [number, number] = [180, 68];
const LOGO_RUNNING: [number, number] = [104, 26];

/** Whichever mark belongs on the page, at the size asked for. */
function logoNode(clientLogo: DocMeta["clientLogo"], fit: [number, number]): Content | null {
  if (clientLogo) {
    return clientLogo.kind === "svg"
      ? { svg: clientLogo.data, fit }
      : { image: clientLogo.data, fit };
  }
  if (LOGO) return { svg: LOGO, fit };
  return null;
}

/**
 * Renders a one-line PDF containing the logo, to find out whether it can be
 * drawn at all. Called before a logo is saved, so a file the engine cannot
 * handle is rejected at upload rather than breaking every later export.
 */
export async function probeLogo(kind: "image" | "svg", data: string): Promise<boolean> {
  try {
    await renderPdf({
      pageSize: "A4",
      defaultStyle: { font: "Helvetica" },
      content: [
        kind === "svg"
          ? { svg: data, fit: LOGO_LETTERHEAD }
          : { image: data, fit: LOGO_LETTERHEAD },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wraps report content in the same chrome every time: who produced it, when,
 * from which product, and a page number on every page. An exported document
 * that cannot say when it was run is not evidence of anything.
 */
export function buildDocument(meta: DocMeta, body: Content[]): TDocumentDefinitions {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  // Wrapped in a stack so the spacing below it can be set without having to
  // widen the image/svg union by hand.
  // A4 less the 40pt side margins, so the footer rule spans the text column
  // exactly rather than being eyeballed.
  const contentWidth = (meta.landscape ? 841.89 : 595.28) - 80;

  const mark = logoNode(meta.clientLogo ?? null, LOGO_LETTERHEAD);
  const letterhead: Content | null = mark
    ? { stack: [mark], margin: [0, 0, 0, 30] as [number, number, number, number] }
    : null;

  return {
    pageSize: "A4",
    pageOrientation: meta.landscape ? "landscape" : "portrait",
    // Top clears the running header: 20pt down plus a 26pt mark is 46pt, so 78
    // leaves 32pt of air. Page one has no logo up there — it is in the content
    // instead — so it gets the same margin and more room besides.
    //
    // Bottom holds four things: a rule, the notice (which wraps to two lines
    // on the longest of the three packs), and the generated/page row. That is
    // about 46pt of ink plus a 12pt gap above it, so 64 leaves the last line
    // clear of the paper edge rather than sitting on it.
    pageMargins: [40, 78, 40, 64],
    defaultStyle: { font: "Helvetica", fontSize: 9, color: "#0f172a", lineHeight: 1.25 },
    styles,
    info: {
      title: safe(meta.title),
      author: "Offset Security",
      subject: safe(`${product.name} — ${product.framework}`),
      creator: safe(product.name),
    },
    header: (currentPage: number) => {
      const identity = {
        stack: [
          { text: safe(product.name), style: "small", bold: true, color: NAVY },
          { text: safe(product.framework), style: "small" },
        ],
        alignment: "right" as const,
        margin: [0, 2, 0, 0] as [number, number, number, number],
      };
      // Page one shows the logo at letterhead size in the content, so putting
      // it up here as well would be the same mark twice on one page.
      const running = currentPage === 1 ? null : logoNode(meta.clientLogo ?? null, LOGO_RUNNING);
      return {
        columns: running ? [running, identity] : [{ text: "" }, identity],
        margin: [40, 20, 40, 0],
      };
    },
    footer: (currentPage: number, pageCount: number) => ({
      stack: [
        // A hairline, so the notice reads as chrome rather than as the last
        // paragraph of the report.
        {
          canvas: [
            {
              type: "line" as const,
              x1: 0,
              y1: 0,
              x2: contentWidth,
              y2: 0,
              lineWidth: 0.5,
              lineColor: "#e2e8f0",
            },
          ],
          margin: [0, 0, 0, 6] as [number, number, number, number],
        },
        {
          text: safe(
            `\u00a9 ${new Date().getFullYear()} Offset Security` +
            (meta.edition ? `  ·  ${meta.edition}` : "") +
              `  ·  ${meta.disclaimer}` +
              `  ·  For more information contact ${meta.contact}`,
          ),
          style: "footnote",
          margin: [0, 0, 0, 5] as [number, number, number, number],
        },
        {
          columns: [
            {
              // With the customer's logo in the header, this is where the tool
              // is credited — the document belongs to them, not to us.
              text: safe(
                meta.clientLogo
                  ? `Generated ${stamp} by ${meta.generatedBy} · Produced with ${product.name}`
                  : `Generated ${stamp} by ${meta.generatedBy}`,
              ),
              style: "small",
            },
            {
              text: safe(`Page ${currentPage} of ${pageCount}`),
              style: "small",
              alignment: "right" as const,
            },
          ],
        },
      ],
      margin: [40, 12, 40, 0],
    }),
    content: [
      ...(letterhead ? [letterhead] : []),
      { text: safe(meta.title), style: "h1" },
      { text: safe(meta.subtitle), style: "lede" },
      ...body,
    ],
  };
}

/** Renders a definition to a buffer. */
export async function renderPdf(doc: TDocumentDefinitions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = printer.createPdfKitDocument(doc);
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    stream.end();
  });
}
