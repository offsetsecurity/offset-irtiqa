import { readZip, writeZip } from "../lib/zip.js";

/**
 * Puts the customer's answers into a template.
 *
 * The templates are made by our own build, which marks every blank as a Word
 * content control tagged with the blank's name, and gives every table whose
 * rows come from the product a title such as "source:risk_plan". That is what
 * makes it safe to edit the XML as text here: the shapes are ours, known in
 * advance, and covered by a test that fills every template the pack ships.
 *
 * Anything with no answer is left exactly as it was, yellow, so the document
 * still shows at a glance what is left to do.
 */

export interface Answers {
  /** The answer for a named blank, or undefined to leave it yellow. */
  value(key: string): string | undefined;
  /** The rows for a table, or undefined to leave its example rows. */
  rows(table: string): string[][] | undefined;
}

const YELLOW = /<w:highlight w:val="yellow"\/>/g;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const unesc = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** The text of a run's w:t elements. */
const textOf = (xml: string): string =>
  unesc([...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));

/** A run in the given formatting, with the yellow taken off. Lines become line breaks. */
function run(rPr: string, text: string, keepYellow = false): string {
  const pr = keepYellow ? rPr : rPr.replace(YELLOW, "");
  const body = text
    .split(/\r?\n/)
    .map((line) => `<w:t xml:space="preserve">${esc(line)}</w:t>`)
    .join("<w:br/>");
  return `<w:r>${pr}${body}</w:r>`;
}

const firstRPr = (xml: string): string => /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(xml)?.[0] ?? "";

/** The instructions page ends at the first page break. A filled document no longer needs it. */
function dropInstructions(xml: string): string {
  const brk = xml.indexOf('<w:br w:type="page"/>');
  if (brk < 0) return xml;
  const bodyStart = xml.indexOf("<w:body>") + "<w:body>".length;
  const paraEnd = xml.indexOf("</w:p>", brk) + "</w:p>".length;
  return xml.slice(0, bodyStart) + xml.slice(paraEnd);
}

/** One row per record, each a copy of the table's first example row. */
function fillTable(tbl: string, rows: string[][]): string {
  const trs = [...tbl.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)];
  if (trs.length < 2) return tbl;
  const header = trs[0]![0];
  const example = trs[1]![0];
  const titles = [...header.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => textOf(m[0]).trim());
  const made = rows.map((values) => {
    let i = 0;
    return example.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (tc) => {
      const value = (values[i] ?? "").trim();
      const title = titles[i] ?? "";
      i++;
      const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(tc)?.[0] ?? "";
      const tcPr = /<w:tcPr>[\s\S]*?<\/w:tcPr>/.exec(tc)?.[0] ?? "";
      const rPr = firstRPr(tc);
      // An empty value is a blank to fill in Word, named after its column.
      const yellow = rPr.includes("w:highlight") ? rPr : rPr.replace("</w:rPr>", '<w:highlight w:val="yellow"/></w:rPr>');
      const r = value ? run(rPr, value) : run(yellow, `<${title}>`, true);
      return `<w:tc>${tcPr}<w:p>${pPr}${r}</w:p></w:tc>`;
    });
  });
  const firstAt = trs[1]!.index!;
  const lastEnd = trs[trs.length - 1]!.index! + trs[trs.length - 1]![0].length;
  return tbl.slice(0, firstAt) + made.join("") + tbl.slice(lastEnd);
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Fills document.xml. Returns the new XML and how many blanks are still yellow. */
export function fillDocumentXml(xml: string, answers: Answers): { xml: string; left: number } {
  let out = dropInstructions(xml);

  out = out.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const title = /<w:tblCaption w:val="((?:source|list):[^"]+)"\/>/.exec(tbl)?.[1];
    if (!title) return tbl;
    const rows = answers.rows(title);
    return rows && rows.length ? fillTable(tbl, rows) : tbl;
  });

  out = fillControls(out, answers);

  return { xml: out, left: (out.match(YELLOW) ?? []).length };
}

/** Fills every named blank (content control) in one part of the file. */
function fillControls(xml: string, answers: Answers): string {
  return xml.replace(
    /<w:sdt><w:sdtPr>([\s\S]*?)<\/w:sdtPr><w:sdtContent>([\s\S]*?)<\/w:sdtContent><\/w:sdt>/g,
    (whole, pr: string, content: string) => {
      const tag = /<w:tag w:val="([^"]*)"\/>/.exec(pr)?.[1];
      if (tag === undefined) return whole;
      let value: string | undefined;
      if (tag === "~") {
        // A suggestion: its own words, without the brackets.
        value = textOf(content).replace(/^<|>$/g, "");
      } else {
        const cap = tag.endsWith("^");
        const v = answers.value(unesc(cap ? tag.slice(0, -1) : tag));
        value = v && cap ? capitalise(v) : v;
      }
      if (!value || !value.trim()) return whole;
      return run(firstRPr(content), value);
    },
  );
}

/** How many blanks the template has, on the pages that are kept. */
export function countBlanks(xml: string): number {
  return (dropInstructions(xml).match(YELLOW) ?? []).length;
}

/** Fills a .docx. */
export function fillDocx(file: Buffer, answers: Answers): { file: Buffer; left: number; total: number } {
  const entries = readZip(file);
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) throw new Error("This is not a Word document.");
  const before = doc.data.toString("utf8");
  const { xml, left } = fillDocumentXml(before, answers);
  doc.data = Buffer.from(xml, "utf8");
  // The page header and footer can carry a blank too, such as the company name.
  let inParts = 0;
  let inPartsTotal = 0;
  for (const part of entries) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(part.name)) continue;
    const text = part.data.toString("utf8");
    inPartsTotal += (text.match(YELLOW) ?? []).length;
    const filled = fillControls(text, answers);
    inParts += (filled.match(YELLOW) ?? []).length;
    part.data = Buffer.from(filled, "utf8");
  }
  return { file: writeZip(entries), left: left + inParts, total: countBlanks(before) + inPartsTotal };
}

// ── Excel ────────────────────────────────────────────────────────────────────

/** Puts text in one cell, keeping its style. */
function setCell(sheet: string, ref: string, value: string): string {
  const re = new RegExp(`<c r="${ref}"((?: [a-z]+="[^"]*")*?)\\s*(?:/>|>[\\s\\S]*?</c>)`);
  return sheet.replace(re, (_whole, attrs: string) => {
    const keep = attrs.replace(/ t="[^"]*"/, "");
    return `<c r="${ref}"${keep} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  });
}

export interface SheetFill {
  path: string;
  /** Cell reference → text. */
  cells: Record<string, string>;
}

/** Fills cells in an .xlsx. Excel works the formulas out again when it opens it. */
export function fillXlsx(file: Buffer, fill: SheetFill): Buffer {
  const entries = readZip(file);
  const sheet = entries.find((e) => e.name === fill.path);
  if (!sheet) throw new Error("The workbook does not have the expected sheet.");
  let xml = sheet.data.toString("utf8");
  for (const [ref, value] of Object.entries(fill.cells)) {
    if (value.trim()) xml = setCell(xml, ref, value);
  }
  sheet.data = Buffer.from(xml, "utf8");
  const book = entries.find((e) => e.name === "xl/workbook.xml");
  if (book) {
    let b = book.data.toString("utf8");
    b = /<calcPr[^>]*fullCalcOnLoad/.test(b)
      ? b
      : /<calcPr/.test(b)
        ? b.replace(/<calcPr/, '<calcPr fullCalcOnLoad="1"')
        : b.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
    book.data = Buffer.from(b, "utf8");
  }
  return writeZip(entries);
}
