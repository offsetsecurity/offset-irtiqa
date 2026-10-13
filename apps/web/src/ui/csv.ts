/**
 * CSV in and out.
 *
 * Spreadsheets are how compliance data arrives from everywhere else: an asset
 * list from IT, a risk register a consultant wrote, last year's supplier
 * review. Making somebody retype it is how a register ends up half filled.
 *
 * Excel's dialect, not the RFC's: fields quoted only when they must be, CRLF
 * line endings, and a UTF-8 byte order mark on the way out so that Excel opens
 * accented text correctly instead of showing mojibake.
 */

const needsQuotes = (value: string): boolean => /[",\r\n]/.test(value);

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  let text = Array.isArray(value) ? value.join(" ") : String(value);
  // Text that starts like a formula is made plain text, so a title such as
  // "=HYPERLINK(...)" is shown in the spreadsheet rather than run. Numbers stay numbers.
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return needsQuotes(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** For tests: one cell exactly as it is written to the file. */
export const csvCell = cell;

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cell).join(","), ...rows.map((row) => row.map(cell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Offers the file to the browser. Nothing is uploaded anywhere. */
export function download(name: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Let the click start before the URL stops being valid.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Parses a CSV into rows of strings, handling quotes, doubled quotes and
 * newlines inside fields. Returns [] for an empty file rather than throwing:
 * the caller reports "nothing in that file", which is more use than a stack.
 */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;

    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

/** Loose header matching: "Review by", "review_by" and "reviewBy" all agree. */
export const key = (header: string): string => header.toLowerCase().replace(/[^a-z0-9]/g, "");
