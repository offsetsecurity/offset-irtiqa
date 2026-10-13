import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { reports, branding, organisation, type ReportInfo, type BrandLogo } from "../persistence/apiClient.js";
import { ACCEPT, MAX_BYTES, readFile } from "./Branding.js";
import { Icon, type IconName } from "./icons.js";
import { since } from "./format.js";
import { zipFiles } from "./zip.js";

/**
 * Reports, laid out by who reads them.
 *
 * The two papers most people come here for sit at the top as large cards: the
 * board's executive summary and management's readiness plan. Below them, the
 * detail an auditor asks for, then what a management review works from. Each
 * row says who last took a copy, and when, from the audit log, so a team can
 * see whether the board pack has already gone out.
 */

const FEATURED: Record<string, { kicker: string; thumb: "board" | "plan" }> = {
  "executive-summary": { kicker: "For the board", thumb: "board" },
  "readiness-plan": { kicker: "For management", thumb: "plan" },
};
const MANAGEMENT = new Set(["management-review-pack", "document-control-list"]);
const ORDER = [
  "statement-of-applicability", "maturity-assessment", "gap-report", "baseline-tailoring",
  "evidence-register", "risk-register", "management-review-pack", "document-control-list",
];
const ICON: Record<string, IconName> = {
  "statement-of-applicability": "soa",
  "maturity-assessment": "profile",
  "gap-report": "gaps",
  "baseline-tailoring": "system",
  "evidence-register": "evidence",
  "risk-register": "risks",
  "management-review-pack": "reviews",
  "document-control-list": "policies",
};

/** A small drawing of the first page, so the two papers are told apart at a glance. */
function Thumb({ kind }: { kind: "board" | "plan" }): VNode {
  return kind === "board"
    ? html`<svg class="rb-thumb" viewBox="0 0 84 112" aria-hidden="true">
        <rect width="84" height="112" rx="3" fill="#fff"/>
        <rect width="84" height="30" rx="3" fill="#0f1c36"/><rect y="27" width="84" height="3" fill="#0f1c36"/>
        <rect y="30" width="50" height="1.6" fill="#c39a4a"/>
        <rect x="8" y="8" width="20" height="2" rx="1" fill="#8fa0c4"/><rect x="8" y="14" width="40" height="5" rx="1" fill="#fff"/>
        <rect x="58" y="7" width="18" height="7" rx="1" fill="#fff"/>
        <path d="M10 52 A13 13 0 0 1 36 52" fill="none" stroke="#eceff4" stroke-width="5" stroke-linecap="round"/>
        <path d="M10 52 A13 13 0 0 1 28 40" fill="none" stroke="#1b2c52" stroke-width="5" stroke-linecap="round"/>
        <rect x="42" y="38" width="34" height="3" rx="1" fill="#475467"/><rect x="42" y="44" width="30" height="3" rx="1" fill="#c3cad6"/><rect x="42" y="50" width="32" height="3" rx="1" fill="#c3cad6"/>
        ${[0, 1, 2, 3].map((i) => html`<rect x=${8 + i * 17.5} y="60" width="15" height="12" rx="1.5" fill="none" stroke="#e6e9f0"/>`)}
        <rect x="8" y="78" width="33" height="14" rx="1.5" fill="#fffaf0" stroke="#e6e9f0"/><rect x="8" y="78" width="33" height="1.5" fill="#c39a4a"/>
        <rect x="43" y="78" width="33" height="14" rx="1.5" fill="#fffaf0" stroke="#e6e9f0"/><rect x="43" y="78" width="33" height="1.5" fill="#c39a4a"/>
        ${[0, 1, 2].map((i) => html`<rect x="8" y=${97 + i * 4.5} width=${40 + i * 6} height="2.4" rx="1" fill="#1b2c52"/>`)}
      </svg>`
    : html`<svg class="rb-thumb" viewBox="0 0 84 112" aria-hidden="true">
        <rect width="84" height="112" rx="3" fill="#fff"/>
        <rect x="10" y="10" width="14" height="4" rx="1" fill="#2457d6"/>
        <rect x="10" y="20" width="44" height="5" rx="1" fill="#0f172a"/>
        ${[0, 1, 2, 3, 4, 5].map((i) => html`<circle cx=${14 + i * 11} cy="38" r="3.6" fill=${i < 2 ? "#e7f6ec" : "#fdf3e2"} stroke=${i < 2 ? "#16a34a" : "#d97706"} stroke-width="1.2"/>`)}
        ${[0, 1, 2, 3, 4, 5, 6].map((i) => html`<rect x="10" y=${52 + i * 7.5} width=${i % 3 === 0 ? 56 : 46} height="3" rx="1" fill="#e2e8f0"/>`)}
      </svg>`;
}

function LastTaken({ r }: { r: ReportInfo }): VNode {
  const last = r.lastDownloaded;
  return html`<span class="rb-last">${last ? `Last downloaded by ${last.by}, ${since(last.at)}` : "Not downloaded yet"}</span>`;
}

/** Your name and logo, which every report carries. */
function BrandBar({ canEdit }: { canEdit: boolean }): VNode {
  const [logo, setLogo] = useState<BrandLogo | null>(null);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    branding.get().then((l) => live && setLogo(l)).catch(() => { /* optional */ });
    organisation.get().then((n) => { if (live) { setName(n); setSaved(n); } }).catch(() => { /* optional */ });
    return () => { live = false; };
  }, []);

  async function choose(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setError("");
    if (!ACCEPT.split(",").includes(file.type)) return setError("Use a PNG, JPEG or SVG file.");
    if (file.size > MAX_BYTES) return setError(`That file is ${Math.round(file.size / 1024)} KB. The limit is 512 KB.`);
    setBusy(true);
    try {
      const { kind, data } = await readFile(file);
      setLogo(await branding.set({ kind, data, filename: file.name }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError("");
    try { await work(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const preview = logo ? (logo.kind === "svg" ? `data:image/svg+xml;utf8,${encodeURIComponent(logo.data)}` : logo.data) : null;
  return html`<div class="card rb-brand">
    <div class="rb-logo">${preview ? html`<img src=${preview} alt=${logo!.filename || "Your logo"} />` : html`<span>No logo</span>`}</div>
    <div class="rb-brand-copy">
      <b>Your name and logo on every report</b>
      <span class="muted">${logo
        ? `${logo.filename || "Your logo"} · ${Math.max(1, Math.round(logo.bytes / 1024))} KB.`
        : "Until you add one, reports carry the Offset Security mark. PNG, JPEG or SVG, up to 512 KB."}</span>
      ${canEdit
        ? html`<form class="rb-name" onSubmit=${(e: Event) => { e.preventDefault(); void act(async () => { const n = await organisation.set(name); setName(n); setSaved(n); }); }}>
            <input type="text" maxLength=${120} placeholder="Organisation name, for the board paper's cover" aria-label="Organisation name"
                   value=${name} onInput=${(e: Event) => setName((e.target as HTMLInputElement).value)} />
            ${name.trim() !== saved.trim() ? html`<button class="btn small" disabled=${busy}>Save name</button>` : null}
          </form>`
        : saved ? html`<span class="muted">Organisation: ${saved}</span>` : null}
      ${error ? html`<div class="err" role="alert">${error}</div>` : null}
    </div>
    ${canEdit
      ? html`<div class="rb-brand-actions">
          <label class=${`btn${busy ? " disabled" : ""}`}>
            ${busy ? "Checking…" : logo ? "Replace logo" : "Upload logo"}
            <input type="file" accept=${ACCEPT} hidden disabled=${busy} onChange=${(e: Event) => void choose(e)} />
          </label>
          ${logo ? html`<button class="btn danger" disabled=${busy} onClick=${() => void act(async () => setLogo(await branding.set(null)))}>Remove</button>` : null}
        </div>`
      : null}
  </div>`;
}

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ReportsBoard({ isAdmin, scored }: { isAdmin: boolean; scored: boolean }): VNode {
  const [list, setList] = useState<ReportInfo[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [all, setAll] = useState<{ done: number; total: number } | null>(null);
  const [allError, setAllError] = useState("");

  const load = (): void => {
    reports.list().then(setList).catch((err: Error) => setError(err.message));
  };
  useEffect(load, []);

  async function download(r: ReportInfo): Promise<void> {
    setBusy((b) => ({ ...b, [r.id]: true }));
    setFailed((f) => ({ ...f, [r.id]: "" }));
    try {
      const { blob, filename } = await reports.download(r.id);
      save(blob, filename);
      load();
    } catch (err) {
      setFailed((f) => ({ ...f, [r.id]: (err as Error).message }));
    } finally {
      setBusy((b) => ({ ...b, [r.id]: false }));
    }
  }

  async function downloadAll(): Promise<void> {
    if (!list) return;
    setAllError("");
    const files: { name: string; blob: Blob }[] = [];
    try {
      for (const [i, r] of list.entries()) {
        setAll({ done: i, total: list.length });
        const { blob, filename } = await reports.download(r.id);
        files.push({ name: filename, blob });
      }
      setAll({ done: list.length, total: list.length });
      save(await zipFiles(files), `reports-${new Date().toISOString().slice(0, 10)}.zip`);
      load();
    } catch (err) {
      setAllError((err as Error).message);
    } finally {
      setAll(null);
    }
  }

  if (error) return html`<div class="card pad err">${error}</div>`;
  if (!list) return html`<div class="card pad muted">Loading…</div>`;

  const featured = Object.keys(FEATURED).map((id) => list.find((r) => r.id === id)).filter((r): r is ReportInfo => Boolean(r));
  const rest = list.filter((r) => !FEATURED[r.id])
    .sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));
  const auditor = rest.filter((r) => !MANAGEMENT.has(r.id));
  const management = rest.filter((r) => MANAGEMENT.has(r.id));

  const button = (r: ReportInfo, primary: boolean): VNode => html`
    <button class=${`btn${primary ? " primary" : ""}`} disabled=${(busy[r.id] ?? false) || all !== null}
            aria-label=${`Download ${r.title} as PDF`} onClick=${() => void download(r)}>
      ${busy[r.id] ? "Preparing…" : primary ? html`<span class="rb-dl" aria-hidden="true">↓</span> Download PDF` : "Download PDF"}
    </button>`;

  const group = (title: string, note: string, items: ReportInfo[]): VNode | null => items.length
    ? html`<section class="rb-group">
        <h2 class="rb-group-h">${title} <span>${note}</span></h2>
        <div class="card rb-list">
          ${items.map((r) => html`<div class="rb-row" key=${r.id}>
            <span class="rb-icon">${ICON[r.id] ? html`<${Icon} name=${ICON[r.id]} />` : null}</span>
            <div class="rb-row-copy">
              <b>${r.title}</b>
              <span class="muted">${r.description}</span>
              ${failed[r.id] ? html`<div class="err" role="alert">${failed[r.id]}</div>` : null}
            </div>
            <${LastTaken} r=${r} />
            ${button(r, false)}
          </div>`)}
        </div>
      </section>`
    : null;

  return html`<div class="rb">
    <div class="rb-top">
      <span class="rb-live"><i></i>Every report is built from live data when you press the button, dated, and recorded in the audit log.</span>
      <button class="btn" disabled=${all !== null} onClick=${() => void downloadAll()}>
        ${all ? `Preparing ${Math.min(all.done + 1, all.total)} of ${all.total}…` : html`<span class="rb-dl" aria-hidden="true">↓</span> Download all (zip)`}
      </button>
    </div>
    ${allError ? html`<div class="card pad err" role="alert">${allError}</div>` : null}

    <${BrandBar} canEdit=${isAdmin} />

    ${featured.length
      ? html`<div class="rb-featured">
          ${featured.map((r) => html`<div class="card rb-feature" key=${r.id}>
            <${Thumb} kind=${FEATURED[r.id]!.thumb} />
            <div class="rb-feature-copy">
              <span class="rb-kicker">${FEATURED[r.id]!.kicker}</span>
              <h2>${r.title}</h2>
              <p class="muted">${r.description}</p>
              ${failed[r.id] ? html`<div class="err" role="alert">${failed[r.id]}</div>` : null}
              <div class="rb-feature-foot">${button(r, true)}<${LastTaken} r=${r} /></div>
            </div>
          </div>`)}
        </div>`
      : null}

    ${group("For your auditor", scored ? "The detail behind every score" : "What an auditor asks to see", auditor)}
    ${group("For the management system", "What a review meeting works from", management)}
  </div>`;
}
