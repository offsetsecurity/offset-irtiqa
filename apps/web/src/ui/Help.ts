import { useEffect, useMemo, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { help, type HelpPage } from "../persistence/apiClient.js";
import { render } from "./markdown.js";

/**
 * Help, and the guides, read inside the product.
 *
 * Documentation that lives on somebody's laptop is documentation nobody opens.
 * These ship in the pack, so they are on every install, including the ones with
 * no way out to the internet, and they describe this version rather than
 * whatever was current when the PDF was made.
 *
 * One component serves both menu items: the short answers and the long guides
 * are the same shape of thing, and a reader moving between them should not
 * notice a change of furniture.
 */
/** The product's name, for the version line at the top of Help. */
const PRODUCT_NAME = import.meta.env.PRODUCT_NAME as unknown as string;

export function Help({ kind, version = "" }: { kind: "help" | "guides"; version?: string }): VNode {
  const [pages, setPages] = useState<HelpPage[] | null>(null);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    help
      .index()
      .then((index) => {
        if (!live) return;
        setNote(index.note);
        const list = kind === "help" ? index.help : index.guides;
        setPages(list);
        setOpen(list[0]?.file ?? "");
      })
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, [kind]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setBody("");
    help
      .page(open)
      .then((text) => live && setBody(text))
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, [open]);

  const rendered = useMemo(() => (body ? render(body) : null), [body]);
  /** Section headings, offered as a contents list once a page is long enough to need one. */
  const contents = useMemo(
    () => (rendered?.headings ?? []).filter((h) => h.level === 2),
    [rendered],
  );

  /** A new page starts at its top, not wherever the last one was scrolled to. */
  useEffect(() => {
    if (body) document.querySelector(".help-body")?.scrollIntoView({ block: "start" });
  }, [body]);

  /** A link to another page in the pack opens it here. */
  function follow(e: Event): void {
    const link = (e.target as HTMLElement).closest("a[data-doc]");
    if (!link) return;
    e.preventDefault();
    setOpen(link.getAttribute("data-doc") ?? "");
  }

  const jump = (id: string): void =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (error) return html`<div class="card pad err">${error}</div>`;
  if (!pages) return html`<div class="card pad muted">Loading…</div>`;

  return html`<div class="help-layout">
    <div class="card pad help-index">
      <h2 class="section-h">${kind === "help" ? "Help" : "Guides"}</h2>
      ${version ? html`<p class="help-version">${PRODUCT_NAME}, version ${version}</p>` : null}
      <p class="muted section-note">${note}</p>
      ${pages.map((p, i) => html`
        ${p.group && p.group !== pages[i - 1]?.group
          ? html`<div class="help-group" key=${`g-${p.group}`}>${p.group}</div>`
          : null}
        <button type="button" key=${p.file}
                class=${`help-pick${p.file === open ? " sel" : ""}`}
                onClick=${() => setOpen(p.file)}>
          <span class="help-pick-title">${p.title}</span>
          <span class="help-pick-about">${p.about}</span>
        </button>`)}
    </div>

    <div class="card pad help-body">
      ${rendered && contents.length >= 4
        ? html`<nav class="toc" aria-label="On this page">
            <div class="toc-h">On this page</div>
            <ol>
              ${contents.map((h) => html`
                <li key=${h.id}>
                  <button type="button" onClick=${() => jump(h.id)}>${h.text}</button>
                </li>`)}
            </ol>
          </nav>`
        : null}
      ${rendered
        ? html`<div class="prose" onClick=${follow}
                   dangerouslySetInnerHTML=${{ __html: rendered.html }}></div>`
        : html`<span class="muted">Loading…</span>`}
    </div>
  </div>`;
}
