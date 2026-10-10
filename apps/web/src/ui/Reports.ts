import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { reports, type ReportInfo } from "../persistence/apiClient.js";
import { Branding } from "./Branding.js";

/**
 * Reports.
 *
 * One card per report, one button, one PDF. The download is fetched rather
 * than linked so that a failure — an expired session, a server error — shows
 * as a message on the card instead of dumping the browser on a broken page,
 * and so the button can say it is working while a long report renders.
 */
export function Reports({ isAdmin }: { isAdmin: boolean }): VNode {
  const [list, setList] = useState<ReportInfo[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    reports
      .list()
      .then((r) => live && setList(r))
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  async function download(report: ReportInfo): Promise<void> {
    setBusy((b) => ({ ...b, [report.id]: true }));
    setFailed((f) => ({ ...f, [report.id]: "" }));
    try {
      const { blob, filename } = await reports.download(report.id);

      // Hand the file to the browser, then release the object URL. Without the
      // revoke the blob stays in memory for the life of the page.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      setDone((d) => ({ ...d, [report.id]: `${Math.max(1, Math.round(blob.size / 1024))} KB` }));
    } catch (err) {
      setFailed((f) => ({ ...f, [report.id]: (err as Error).message }));
    } finally {
      setBusy((b) => ({ ...b, [report.id]: false }));
    }
  }

  if (error) return html`<div class="card pad err">${error}</div>`;
  if (!list) return html`<div class="card pad muted">Loading…</div>`;

  return html`<>
    <${Branding} canEdit=${isAdmin} />

    <p class="muted" style="margin:16px 0;max-width:75ch;font-size:12.5px">
      Every report is built from the live data at the moment you press the button, and
      carries the date, the framework and who produced it. Each export is recorded in
      the audit log.
    </p>

    <div class="report-grid">
      ${list.map((r) => html`
        <div class="card pad report" key=${r.id}>
          <div class="report-title">${r.title}</div>
          <p class="muted">${r.description}</p>
          ${failed[r.id] ? html`<div class="err" role="alert">${failed[r.id]}</div>` : null}
          <div class="report-foot">
            <button class="btn primary" disabled=${busy[r.id] ?? false}
                    onClick=${() => void download(r)}>
              ${busy[r.id] ? "Preparing…" : "Download PDF"}
            </button>
            ${done[r.id] && !busy[r.id]
              ? html`<span class="muted" style="font-size:11.5px">downloaded · ${done[r.id]}</span>`
              : null}
          </div>
        </div>`)}
    </div>
  </>`;
}
