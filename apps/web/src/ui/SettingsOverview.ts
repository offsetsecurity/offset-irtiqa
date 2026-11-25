import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import {
  demo, settingsOverview, updates,
  type SettingsEvent, type SettingsOverview as Data, type UpdateCheck,
} from "../persistence/apiClient.js";

/**
 * The Global Settings page: the tab strip and the Overview.
 *
 * Every Offset product has this page. A strip of tabs runs across the top, one
 * for each section, each with a pill that says in a word whether it is on. The
 * first tab is the Overview: a box for each section with its state, the details
 * that matter, what changed lately (from the audit trail) and a link that opens
 * it; under the boxes, the facts about this server an auditor or an IT team
 * asks for, with a button to copy them.
 *
 * Nothing here changes anything or contacts anything outside this server.
 */

export type Tone = "on" | "off" | "warn" | "bad";

const DAY = 86_400_000;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
const shortDay = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const when = (iso: string | null): string => {
  if (!iso) return "Never";
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return `Today, ${time}`;
  if (d.toDateString() === new Date(Date.now() - DAY).toDateString()) return `Yesterday, ${time}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
const bytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;
const duration = (s: number): string => {
  const days = Math.floor(s / 86_400);
  if (days >= 1) return plural(days, "day");
  const hours = Math.floor(s / 3600);
  if (hours >= 1) return plural(hours, "hour");
  return plural(Math.max(1, Math.floor(s / 60)), "minute");
};

/** Audit action names as a person would say them. */
const ACTION: Record<string, string> = {
  "Update requested": "Update started",
};
const event = (e: SettingsEvent): string => `${ACTION[e.action] ?? e.action} ${shortDay(e.at)} by ${e.actor}`;

const INSTALL: Record<string, string> = { docker: "Docker", windows: "Windows installer", linux: "Linux", none: "Run by hand" };
const ROLE_ORDER: [string, string][] = [["admin", "admin"], ["contributor", "contributor"], ["auditor", "auditor"], ["readonly", "read-only user"]];

/** The sections, in the order of the strip. `example` is there only where a product has example data. */
export const SETTINGS_TABS = [
  { id: "overview", label: "Overview" },
  { id: "updates", label: "Updates" },
  { id: "https", label: "HTTPS" },
  { id: "email", label: "Outgoing email" },
  { id: "digest", label: "Daily digest" },
  { id: "example", label: "Example data" },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

export interface OverviewState {
  data: Data | null;
  check: UpdateCheck | null;
  example: number | null;
  error: string;
}

/** Reads the overview again whenever `again` changes, so a pill never shows what a section was before it was saved. */
export function useOverview(hasExample: boolean, again: string): OverviewState {
  const [data, setData] = useState<Data | null>(null);
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [example, setExample] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    settingsOverview.get().then(setData).catch((e: Error) => setError(e.message));
    updates.get().then((u) => setCheck(u.lastCheck)).catch(() => {});
    if (hasExample) demo.state().then((d) => setExample(d.rows)).catch(() => {});
  }, [again]);
  return { data, check, example, error };
}

/** The pill each section shows, in the strip and on its box. */
function pills(s: OverviewState): Record<string, [Tone, string]> {
  const d = s.data;
  if (!d) return {};
  const version = d.server.version;
  const ready = Boolean(s.check?.newer && s.check.current === version);
  return {
    updates: ready ? ["warn", "Update ready"] : ["off", `v${version}`],
    https: d.https.on ? ["on", "On"] : ["bad", "Off"],
    email: d.email.enabled ? ["on", "On"] : ["off", "Off"],
    digest: d.digest.enabled ? ["on", "On"] : ["off", "Off"],
    example: s.example ? ["on", "Loaded"] : ["off", "None"],
  };
}

const Pill = ({ tone, children }: { tone: Tone; children: string }): VNode =>
  html`<span class=${`st-pill ${tone}`}><i aria-hidden="true"></i>${children}</span>`;

export function SettingsTabs({ active, state, hasExample }: { active: SettingsTab; state: OverviewState; hasExample: boolean }): VNode {
  const p = pills(state);
  return html`<nav class="gs-tabs" aria-label="Settings sections">
    ${SETTINGS_TABS.filter((t) => t.id !== "example" || hasExample).map((t) => {
      const pill = p[t.id];
      return html`<a key=${t.id} href=${`#/settings${t.id === "overview" ? "" : `/${t.id}`}`}
          class=${active === t.id ? "on" : ""} aria-current=${active === t.id ? "page" : undefined}>
        ${t.label}${pill ? html` <${Pill} tone=${pill[0]}>${pill[1]}<//>` : null}
      </a>`;
    })}
  </nav>`;
}

function Box({ id, title, pill, alert, rows, history, empty, note, link }: {
  id: SettingsTab;
  title: string;
  pill: [Tone, string];
  alert?: boolean;
  rows: [string, unknown, boolean?][];
  history: SettingsEvent[];
  empty: string;
  note: string;
  link: string;
}): VNode {
  return html`<a class=${`gs-box${alert ? " alert" : ""}`} href=${`#/settings/${id}`}>
    <span class="gs-box-h"><b>${title}</b><${Pill} tone=${pill[0]}>${pill[1]}<//></span>
    <span class="gs-kv">
      ${rows.map(([k, v, bad]) => html`<span>${k}</span><b class=${bad ? "bad" : ""}>${v}</b>`)}
    </span>
    <span class="gs-hist">
      ${history.length
        ? history.slice(0, 2).map((e) => html`<span class="gs-hist-e" key=${e.at + e.action}>${event(e)}</span>`)
        : html`<span class="gs-hist-e">${empty}</span>`}
    </span>
    <span class="gs-box-f"><span>${note}</span><span class="gs-link">${link} →</span></span>
  </a>`;
}

export function SettingsOverview({ state, hasExample }: { state: OverviewState; hasExample: boolean }): VNode {
  const [copied, setCopied] = useState("");
  const { data, check, example, error } = state;
  if (!data) return html`<section class="card pad muted">${error || "Loading…"}</section>`;

  const p = pills(state);
  const s = data.server;
  const address = location.origin;
  const encrypted = location.protocol === "https:";
  const updateReady = Boolean(check?.newer && check.current === s.version);
  const people = ROLE_ORDER.filter(([r]) => s.people[r]).map(([r, w]) => plural(s.people[r]!, w));
  const totalPeople = Object.values(s.people).reduce((a, b) => a + b, 0);

  const facts: [string, string, string, ("ok" | "bad")?][] = [
    ["Version", s.version, updateReady ? "A newer version is ready" : "Checks only when you press the button"],
    ["Installed with", INSTALL[s.installKind] ?? s.installKind, "Updates from Settings → Updates"],
    ["Address", address, encrypted ? "Encrypted (HTTPS)" : "Plain HTTP, not encrypted", encrypted ? "ok" : "bad"],
    ["Time zone", s.timeZone, "Due dates and “today” follow this"],
    ["Last backup", s.backups.last ? when(s.backups.last.at) : "None yet",
      s.backups.enabled ? `Nightly backups on. ${s.backups.count} kept` : "Nightly backups are off",
      s.backups.enabled && s.backups.last ? "ok" : "bad"],
    ["Database", bytes(s.databaseBytes), `Evidence files: ${bytes(s.evidence.bytes)}${s.evidence.partial ? " or more" : ""}`],
    ["People", plural(totalPeople, "account"), people.join(", ") || "None"],
    ["Running for", duration(s.uptimeSeconds), "Since the last restart"],
  ];

  async function copy(): Promise<void> {
    const text = ["About this server", ...facts.map(([k, v, note]) => `${k}: ${v} (${note})`)].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Copied.");
    } catch {
      setCopied("Your browser would not copy it.");
    }
  }

  return html`
    <section class="card gs-card" aria-label="Overview">
      <header class="gs-card-h">
        <h2>Overview</h2>
        <p>Everything in Settings at a glance, with what changed lately. Click a box to change it.</p>
      </header>
      <div class="gs-grid">
        <${Box} id="updates" title="Updates" pill=${p["updates"]!}
          rows=${[["Version", s.version], ["Installed with", INSTALL[s.installKind] ?? s.installKind], ["Last check", check ? when(check.checkedAt) : "Never"]]}
          history=${data.history["updates"] ?? []} empty="No updates started from here yet"
          note="Checks only when you press the button." link=${updateReady ? "Update now" : "Check for updates"} />
        <${Box} id="https" title="HTTPS" alert=${!data.https.on} pill=${p["https"]!}
          rows=${[["Address", address], ["Certificate", data.https.on ? (data.https.source === "uploaded" ? "Uploaded here" : "From the settings file") : "None"],
            ...(data.https.on ? [] : [["Risk", "Passwords cross the network unprotected", true]])] as [string, unknown, boolean?][]}
          history=${data.history["https"] ?? []} empty="No certificate has been added here"
          note=${data.https.on ? "Connections are encrypted." : "Ask your IT team for a certificate."}
          link=${data.https.on ? "Manage" : "Add a certificate"} />
        <${Box} id="email" title="Outgoing email" pill=${p["email"]!}
          rows=${[["Provider", data.email.provider ?? "Not set"], ["Sender", data.email.sender ?? "Not set"],
            ["Last test", data.email.lastTest ? `${when(data.email.lastTest.at)}, ${data.email.lastTest.action === "Email test sent" ? "worked" : "failed"}` : "Never",
              data.email.lastTest?.action === "Email test failed"]]}
          history=${data.history["email"] ?? []} empty="Never set up"
          note="Needed for reminders and invitations." link=${data.email.enabled ? "Manage" : "Set up email"} />
        <${Box} id="digest" title="Daily digest" pill=${p["digest"]!}
          rows=${[["Sent to", data.digest.recipients ? plural(data.digest.recipients, "address") : "Every administrator"],
            ["Looks ahead", `${data.digest.horizonDays} days`], ["Last sent", when(data.digest.lastSent)]]}
          history=${data.history["digest"] ?? []} empty="Never turned on"
          note="Needs outgoing email first." link=${data.digest.enabled ? "Manage" : "Set up"} />
        ${hasExample
          ? html`<${Box} id="example" title="Example data" pill=${p["example"]!}
              rows=${[["Loaded", example ? "Yes" : "No"], ["Rows", String(example ?? 0)]]}
              history=${data.history["example"] ?? []} empty="Never loaded"
              note="A made-up company, to see a filled-in programme." link=${example ? "Manage" : "Load"} />`
          : null}
      </div>
    </section>

    <section class="card gs-card" aria-label="About this server">
      <header class="gs-card-h gs-card-bar">
        <div><h2>About this server</h2><p>The facts an auditor or your IT team asks for. Nothing here is sent anywhere.</p></div>
        <span class="gs-copy">${copied ? html`<span class="muted">${copied}</span>` : null}<button type="button" class="btn" onClick=${copy}>Copy details</button></span>
      </header>
      <dl class="gs-facts">
        ${facts.map(([k, v, note, tone]) => html`<div class="gs-fact" key=${k}>
          <dt>${k}</dt><dd><b>${v}</b><span class=${tone ?? ""}>${note}</span></dd>
        </div>`)}
      </dl>
    </section>`;
}
