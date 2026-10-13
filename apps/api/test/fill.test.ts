import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { readZip, writeZip } from "../src/lib/zip.js";
import { fillDocx, fillXlsx } from "../src/templates/fill.js";

/**
 * Filling a template in.
 *
 * The filler edits the XML of the pack's own Word and Excel files, so what
 * protects it is running it over every real template the pack ships: each
 * must come out as a document Word can open, with the answers in, and the
 * blanks nobody answered still yellow.
 */
const pack = resolve(process.cwd(), "../../packs", readdirSync(resolve(process.cwd(), "../../packs"))[0]!);
const dir = resolve(pack, "templates");
const has = existsSync(resolve(dir, "fields.json"));
const maybe = has ? describe : describe.skip;

interface Doc {
  file: string;
  id: string;
  fields: Record<string, { default: string }>;
  shared: string[];
  sheet?: { path: string; cells: Record<string, string> };
}
const manifest = has
  ? (JSON.parse(readFileSync(resolve(dir, "fields.json"), "utf8")) as { shared: { name: string }[]; documents: Doc[] })
  : { shared: [], documents: [] };

const xmlOf = (buf: Buffer, name: string): string =>
  readZip(buf).find((e) => e.name === name)!.data.toString("utf8");

describe("zip", () => {
  it("writes what it reads", () => {
    const entries = [
      { name: "a.txt", data: Buffer.from("hello ".repeat(500)) },
      { name: "dir/b.bin", data: Buffer.from([0, 1, 2, 3, 255]) },
      { name: "empty", data: Buffer.alloc(0) },
    ];
    const back = readZip(writeZip(entries));
    expect(back.map((e) => e.name)).toEqual(["a.txt", "dir/b.bin", "empty"]);
    for (let i = 0; i < entries.length; i++) expect(back[i]!.data.equals(entries[i]!.data)).toBe(true);
  });
});

maybe("filling the pack's templates", () => {
  const docx = manifest.documents.filter((d) => d.file.endsWith(".docx"));

  it("ships a manifest that matches the files", () => {
    expect(docx.length).toBeGreaterThanOrEqual(13);
    for (const d of manifest.documents) expect(existsSync(resolve(dir, d.file)), d.file).toBe(true);
    const keys = new Set(manifest.shared.map((s) => s.name));
    for (const d of manifest.documents) for (const k of d.shared) expect(keys.has(k), `${d.file} ${k}`).toBe(true);
  });

  it("names every blank in every document, so nothing is filled by guesswork", () => {
    for (const d of docx) {
      const xml = xmlOf(readFileSync(resolve(dir, d.file)), "word/document.xml");
      const tags = [...xml.matchAll(/<w:tag w:val="([^"]*)"\/>/g)].map((m) => m[1]!.replace(/\^$/, ""));
      expect(tags.length, d.file).toBeGreaterThan(5);
      for (const t of tags) {
        const known = t === "~" || t.startsWith("$") || t.startsWith("pol:") || t.includes(".") ||
          manifest.shared.some((s) => s.name === t);
        expect(known, `${d.file} has an unknown blank ${t}`).toBe(true);
      }
    }
  });

  it("fills a template and leaves a document Word can open", () => {
    for (const d of docx) {
      const src = readFileSync(resolve(dir, d.file));
      const out = fillDocx(src, {
        value: (k) => (k === "company" ? "Acme & Sons <Ltd>" : k === "04.cost1" ? "5,000" : undefined),
        rows: () => undefined,
      });
      const xml = xmlOf(out.file, "word/document.xml");
      // still well formed: every tag that opens, closes
      expect((xml.match(/<w:sdt>/g) ?? []).length).toBe((xml.match(/<\/w:sdt>/g) ?? []).length);
      expect((xml.match(/<w:p[ >]/g) ?? []).length).toBe((xml.match(/<\/w:p>/g) ?? []).length);
      expect(xml, d.file).not.toMatch(/\{\{|undefined/);
      expect(xml.includes("Template instructions"), `${d.file} drops the instructions page`).toBe(false);
      if (d.shared.includes("company")) {
        expect(xml, d.file).toContain("Acme &amp; Sons &lt;Ltd&gt;");
        expect(out.left, d.file).toBeLessThan(out.total);
      }
    }
  });

  it("fills the starter policies too, including the company name in the page header", () => {
    const d = docx.find((x) => x.file.startsWith("Acceptable_Use"));
    if (!d) return;
    const out = fillDocx(readFileSync(resolve(dir, d.file)), {
      value: (k) => (k === "company" ? "Acme & Sons" : k === "$owner" ? "Priya Shah" : undefined),
      rows: () => undefined,
    });
    const entries = readZip(out.file);
    const header = entries.find((e) => /^word\/header\d*\.xml$/.test(e.name))!.data.toString("utf8");
    expect(header).toContain("Acme &amp; Sons");
    const body = entries.find((e) => e.name === "word/document.xml")!.data.toString("utf8");
    expect(body).toContain("Priya Shah");
    expect(body).not.toContain("&lt;Company name&gt;");
    expect(body.includes("Template instructions")).toBe(false);
  });

  it("leaves an unanswered blank yellow, and fills a suggestion with its own words", () => {
    const d = docx.find((x) => x.id === "ISMS-04");
    if (!d) return;
    const out = fillDocx(readFileSync(resolve(dir, d.file)), { value: () => undefined, rows: () => undefined });
    const xml = xmlOf(out.file, "word/document.xml");
    expect(xml).toContain("&lt;amount&gt;");
    // "<~five>" is a suggestion and reads "five" once filled
    expect(xml).toMatch(/Not expected to happen in the next [^<]*<\/w:t>/);
    expect(xml).not.toContain("&lt;~");
  });

  it("puts one row per record in a table, from the first example row", () => {
    const d = docx.find((x) => x.id === "ISMS-13");
    if (!d) return;
    const out = fillDocx(readFileSync(resolve(dir, d.file)), {
      value: () => undefined,
      rows: (t) => (t === "source:risk_plan"
        ? [["R-001", "Lost laptop", "16", "Modify", "A.8.1", "", "IT lead", "1 March 2027", "6"],
           ["R-002", "Phishing", "12", "Modify", "A.6.3", "", "HR lead", "", ""],
           ["R-003", "Supplier outage", "9", "Share", "A.5.19", "", "Procurement", "", ""]]
        : undefined),
    });
    const xml = xmlOf(out.file, "word/document.xml");
    for (const s of ["Lost laptop", "Phishing", "Supplier outage", "1 March 2027"]) expect(xml).toContain(s);
    expect(xml).not.toContain("Describe the risk");
    // a value with nothing in it is a blank to fill in Word, named after its column
    expect(xml).toContain("&lt;Resources&gt;");
  });

  it("fills the Statement of Applicability workbook and asks Excel to recalculate", () => {
    const d = manifest.documents.find((x) => x.sheet);
    if (!d) return;
    const src = readFileSync(resolve(dir, d.file));
    const ref = Object.keys(d.sheet!.cells)[0]!;
    const out = fillXlsx(src, { path: d.sheet!.path, cells: { [ref]: "Acme & Sons", D14: "Yes" } });
    const sheet = xmlOf(out, d.sheet!.path);
    expect(sheet).toContain("Acme &amp; Sons");
    expect(xmlOf(out, "xl/workbook.xml")).toContain('fullCalcOnLoad="1"');
    expect((sheet.match(/<c /g) ?? []).length).toBeGreaterThan(900);
  });
});
