import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { idsForRefs } from "./suggest.js";
import type { LinkOption } from "./Register.js";
import { pack as packApi, assets, risks } from "../persistence/apiClient.js";

/**
 * Starting points for an empty register.
 *
 * The hardest part of a first assessment is the blank page. An organisation
 * knows it has assets and risks; it does not know what a register is supposed
 * to look like, so it writes four entries and stops. This gives them a hundred
 * to react to, which is a far easier job than inventing them.
 *
 * Adding copies a row into the real register and nothing more. There is no link
 * back to the library, no "managed by Offset" flag, nothing to un-pick later:
 * once added it is their row, to rename or delete like any other. A sample that
 * stayed tethered to us would be a sample nobody dared edit.
 *
 * Already-added entries are dimmed rather than hidden, so somebody working
 * through a list does not lose their place each time they click.
 */

interface SampleAsset {
  name: string;
  type: string;
  /** "Primary asset" or "Supporting asset"; older packs say neither. */
  category?: string;
  criticality: string;
  classification: string;
  location: string;
  refs?: string[];
}

interface SampleRisk {
  title: string;
  description: string;
  category: string;
  likelihood: number;
  impact: number;
  treatment: string;
  owner: string;
  refs?: string[];
}

interface Group<T> {
  id: string;
  name: string;
  items: T[];
}

interface Samples {
  note: string;
  assets: Group<SampleAsset>[];
  risks: Group<SampleRisk>[];
}

const band = (l: number, i: number): string => {
  const score = l * i;
  if (score >= 20) return "crit";
  if (score >= 12) return "high";
  if (score >= 6) return "med";
  return "low";
};

export function SampleLibrary({
  kind,
  canEdit,
  onAdded,
  controls = [],
}: {
  kind: "assets" | "risks";
  canEdit: boolean;
  onAdded: () => void;
  /** The product's controls, so a sample's named controls can be linked when it is added. */
  controls?: LinkOption[];
}): VNode {
  const [samples, setSamples] = useState<Samples | null>(null);
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  /** What is already in the register, by name, so nothing is offered twice. */
  async function loadExisting(): Promise<void> {
    if (kind === "assets") {
      const rows = await assets.list();
      setTaken(new Set(rows.map((r) => String(r["name"] ?? "").trim().toLowerCase())));
    } else {
      const { risks: rows } = await risks.list();
      setTaken(new Set(rows.map((r) => r.title.trim().toLowerCase())));
    }
  }

  useEffect(() => {
    let live = true;
    Promise.all([packApi.samples(), loadExisting()])
      .then(([raw]) => {
        if (!live) return;
        // The pack type is deliberately loose - one shape for four products -
        // so it is narrowed here, where the fields are actually read.
        const s = raw as unknown as Samples;
        setSamples(s);
        setOpen((cur) => cur || (kind === "assets" ? s.assets : s.risks)[0]?.id || "");
      })
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, [kind]);

  async function add(key: string, make: () => Promise<unknown>): Promise<void> {
    setBusy(key);
    setError("");
    try {
      await make();
      await loadExisting();
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  const addAsset = (a: SampleAsset): Promise<void> =>
    add(a.name, () =>
      assets.create({
        name: a.name,
        type: a.type,
        // What the pack says it is. Information and business processes are
        // primary assets; marking everything supporting made the register
        // disagree with itself the moment anything was imported.
        category: a.category ?? "Supporting asset",
        criticality: a.criticality,
        classification: a.classification,
        owner: "",
        location: a.location,
        notes: "",
        controlIds: idsForRefs(a.refs, controls),
        riskIds: [],
      }),
    );

  const addRisk = (r: SampleRisk): Promise<void> =>
    add(r.title, () =>
      risks.create({
        title: r.title,
        description: r.description,
        category: r.category,
        likelihood: r.likelihood,
        impact: r.impact,
        treatment: r.treatment,
        status: "Open",
        owner: r.owner,
        // The controls the library says treat this risk. Dropping them left every
        // sample risk showing as untreated the moment it was added.
        controlIds: idsForRefs(r.refs, controls),
      }),
    );

  if (error && !samples) return html`<div class="card pad error-box">${error}</div>`;
  if (!samples) return html`<div class="card pad muted">Loading…</div>`;

  const groups: Group<SampleAsset | SampleRisk>[] =
    kind === "assets" ? samples.assets : samples.risks;
  const group = groups.find((g) => g.id === open) ?? groups[0]!;

  const nameOf = (item: SampleAsset | SampleRisk): string =>
    "name" in item ? item.name : item.title;

  const remaining = (g: Group<SampleAsset | SampleRisk>): number =>
    g.items.filter((i) => !taken.has(nameOf(i).trim().toLowerCase())).length;

  const addAll = async (): Promise<void> => {
    for (const item of group.items) {
      if (taken.has(nameOf(item).trim().toLowerCase())) continue;
      if ("name" in item) await addAsset(item);
      else await addRisk(item);
    }
  };

  return html`
    <div class="card pad">
      <p class="sl-note">${samples.note}</p>

      ${error ? html`<div class="err">${error}</div>` : null}

      <div class="sl-groups">
        ${groups.map(
          (g) => html`<button type="button" key=${g.id}
            class=${`sl-group${g.id === group.id ? " sel" : ""}`}
            onClick=${() => setOpen(g.id)}>
            ${g.name}
            <span class="sl-count">${remaining(g)} of ${g.items.length}</span>
          </button>`,
        )}
      </div>

      <div class="sl-head">
        <h2>${group.name}</h2>
        ${canEdit && remaining(group) > 0
          ? html`<button type="button" class="btn small" disabled=${Boolean(busy)}
                   onClick=${() => void addAll()}>
              Add all ${remaining(group)}
            </button>`
          : null}
      </div>

      <div class="sl-list">
        ${group.items.map((item) => {
          const label = nameOf(item);
          const already = taken.has(label.trim().toLowerCase());
          const isRisk = !("name" in item);
          const r = item as SampleRisk;

          return html`<div class=${`sl-row${already ? " taken" : ""}`} key=${label}>
            <div class="sl-main">
              <div class="sl-name">${label}</div>
              ${isRisk
                ? html`<div class="sl-desc muted">${r.description}</div>`
                : null}
              <div class="sl-meta muted">
                ${isRisk
                  ? html`<>
                      <span class=${`sl-band ${band(r.likelihood, r.impact)}`}>
                        ${r.likelihood} × ${r.impact}
                      </span>
                      ${r.category} · ${r.treatment} · ${r.owner}
                    </>`
                  : html`<>
                      ${(item as SampleAsset).type} ·
                      ${(item as SampleAsset).category ?? "Supporting asset"} ·
                      ${(item as SampleAsset).criticality} criticality ·
                      ${(item as SampleAsset).classification} ·
                      ${(item as SampleAsset).location}
                    </>`}
                ${item.refs?.length
                  ? html`<span class="sl-refs">covers ${item.refs.join(", ")}</span>`
                  : null}
              </div>
            </div>

            ${already
              ? html`<span class="sl-in">In your register</span>`
              : canEdit
                ? html`<button type="button" class="btn small primary"
                         disabled=${Boolean(busy)}
                         onClick=${() =>
                           void ("name" in item ? addAsset(item) : addRisk(item))}>
                    ${busy === label ? "Adding…" : "Add"}
                  </button>`
                : null}
          </div>`;
        })}
      </div>
    </div>`;
}
