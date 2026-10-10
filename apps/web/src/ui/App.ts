import { useEffect, useRef, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";

import {
  auth, health, pack, controls as controlsApi, risks as risksApi,
  type Pack, type SessionUser,
} from "../persistence/apiClient.js";
import { Brand, ProductMark } from "./Brand.js";
import { Icon } from "./icons.js";
import { Login } from "./Login.js";
import { ChangePasswordDialog, ChooseNewPassword } from "./ChangePassword.js";
import { Dashboard } from "./Dashboard.js";
import { Controls } from "./Controls.js";
import { Evidence } from "./Evidence.js";
import { Risks } from "./Risks.js";
import { Register, type LinkOption } from "./Register.js";
import { Profile } from "./Profile.js";
import { Soa } from "./Soa.js";
import { Baseline } from "./Baseline.js";
import { Journey } from "./Journey.js";
import { GoldenThread } from "./GoldenThread.js";
import { Programme } from "./Programme.js";
import { Isms } from "./Isms.js";
import { Escalation } from "./Escalation.js";
import { SampleLibrary } from "./SampleLibrary.js";
import { RegisterSamples, REGISTER_SAMPLES } from "./RegisterSamples.js";
import { Reports } from "./Reports.js";
import { Users } from "./Users.js";
import { Settings } from "./Settings.js";
import { Calendar } from "./Calendar.js";
import { Help } from "./Help.js";
import { Gaps } from "./Gaps.js";
import { Templates } from "./Templates.js";
import { Backups } from "./Backups.js";
import { AuditTrail } from "./AuditTrail.js";
import {
  assetRegister, policyRegister, taskRegister, incidentRegister, findingRegister,
  vendorRegister,
  trainingRegister,
  objectiveRegister,
  partyRegister,
  reviewRegister,
  communicationRegister,
  findingRegisterWithCorrectiveAction,
} from "./registers.js";
import { plural } from "./format.js";

/**
 * Hash routing, deliberately — see ADR 0003. It survives being hosted under a
 * subpath or behind a proxy that rewrites URLs, which is the normal situation
 * for software installed on someone else's server.
 */
const ROUTES = [
  // "getready" first on purpose. A customer with no security team opens this
  // product not knowing what to do, and the plan is the answer to that.
  "getready", "thread", "dashboard", "isms", "profile", "soa", "system", "controls", "evidence",
  "risks", "assets", "policies", "tasks", "incidents", "findings", "reports",
  "gaps", "vendors", "training", "objectives", "parties", "reviews", "communications",
  "escalation", "calendar",
  "help", "guides",
  "people", "audit", "backups", "settings",
] as const;
type Route = (typeof ROUTES)[number];

/**
 * The menu in groups, top to bottom, with a line between each. Every route is
 * in exactly one; a group with nothing visible in this product is skipped, so
 * no product shows an empty section or a double line.
 */
interface NavSection {
  id: string;
  title: string;
  routes: readonly Route[];
}

/**
 * The menu as named sections that open and close, because one long list had
 * grown past the height of a laptop. Every route is in exactly one; a section
 * with nothing visible in this product is skipped.
 *
 * Settings, Documentation and Help are not here: they are pinned at the foot
 * (PINNED, below), always in view.
 */
const NAV_SECTIONS: readonly NavSection[] = [
  { id: "start", title: "Start", routes: ["getready", "dashboard", "calendar"] },
  {
    id: "compliance", title: "Compliance",
    routes: ["isms", "profile", "soa", "system", "controls", "evidence", "policies"],
  },
  { id: "risk", title: "Risk and assets", routes: ["risks", "assets"] },
  { id: "work", title: "Work", routes: ["tasks", "incidents", "findings"] },
  {
    id: "management", title: "Management system",
    routes: ["vendors", "training", "objectives", "parties", "reviews", "communications"],
  },
  { id: "reports", title: "Reports", routes: ["reports", "gaps"] },
  { id: "admin", title: "Administration", routes: ["people", "escalation", "audit", "backups"] },
];

/** Which sections are open. Only "Start" is, until somebody opens another. */
const SECTIONS_KEY = "offset.nav.sections";
function readSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

/**
 * Always in view at the foot of the menu, outside the part that scrolls.
 *
 * These are the ones people go looking for, and on a laptop they were below the
 * fold of a long menu with nothing to say so. Settings is administrators only,
 * and drops out of the list for everybody else like any other entry.
 */
const PINNED: readonly Route[] = ["settings", "guides", "help"];

/** The first letters of up to two names, for the round marker beside the signed-in person. */
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

/** Collapsed or not is a per-browser preference, not something to store on the server. */
const COLLAPSE_KEY = "offset.sidebar.collapsed";
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Below this width the menu is drawn as icons whatever the saved choice: at
 * full width it would leave no room for the page, and hiding it altogether,
 * as it once did, left a phone with no way to move between screens.
 */
const NARROW = "(max-width: 820px)";
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const media = window.matchMedia(NARROW);
    const onChange = (): void => setNarrow(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

const routeFromHash = (): Route => {
  // Only the first part names the screen: "#/policies/templates" is Policies, on its Templates tab.
  const key = window.location.hash.replace(/^#\/?/, "").split("/")[0] ?? "";
  // The Golden thread is a tab of Risks; "#/thread" from an old bookmark still finds it.
  if (key === "thread") return "risks";
  return (ROUTES as readonly string[]).includes(key) ? (key as Route) : "dashboard";
};

type SubTab = "register" | "samples" | "thread";

/** The Risks tab the address asks for: "#/risks/thread" or "#/thread" is the Golden thread. */
const subTabFromHash = (): SubTab =>
  /^#\/?(thread|risks\/thread)\b/.test(window.location.hash) ? "thread" : "register";

const REGISTERS = {
  assets: assetRegister,
  policies: policyRegister,
  tasks: taskRegister,
  incidents: incidentRegister,
  findings: findingRegister,
  vendors: vendorRegister,
  training: trainingRegister,
  objectives: objectiveRegister,
  parties: partyRegister,
  reviews: reviewRegister,
  communications: communicationRegister,
} as const;

export function App(): VNode {
  const [user, setUser] = useState<SessionUser | null>(null);
  /**
   * Which sub-tab is showing on a register that has a sample library, and a
   * counter that forces the register to re-read after something is added.
   *
   * A sub-tab rather than a screen of its own: samples are a way of filling in
   * a register, not a separate thing to manage, and a fifteenth item in the
   * navigation would say otherwise.
   */
  const [subTab, setSubTab] = useState<SubTab>(subTabFromHash);
  // A tab also puts itself in the address. Otherwise the address stays "#/risks"
  // on the Golden thread tab, and a link back to "#/risks" changes nothing.
  const pickTab = (tab: SubTab): void => {
    setSubTab(tab);
    history.replaceState(null, "", tab === "thread" ? "#/risks/thread" : `#/${route}`);
  };
  /** Documents, or the templates that ship with the pack. */
  const [policyTab, setPolicyTab] = useState<"documents" | "templates">("documents");
  const [addedCount, setAddedCount] = useState(0);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [meta, setMeta] = useState<{ pack: Pack; themes: Record<string, string> } | null>(null);
  const [route, setRoute] = useState<Route>(routeFromHash());
  const [ready, setReady] = useState(false);
  const [linkOptions, setLinkOptions] = useState<Record<string, LinkOption[]>>({});
  const [changingPassword, setChangingPassword] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [sections, setSections] = useState<Record<string, boolean>>(readSections);
  const sectionOpen = (id: string): boolean => sections[id] ?? id === "start";
  const toggleSection = (id: string): void =>
    setSections((cur) => {
      const next = { ...cur, [id]: !(cur[id] ?? id === "start") };
      try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch { /* a private window */ }
      return next;
    });
  const narrow = useNarrow();
  const iconsOnly = collapsed || narrow;
  // Each register opens on its entries, not on whichever tab the last one was left
  // on - unless the address names a tab, as a link to the Golden thread does.
  useEffect(() => setSubTab(subTabFromHash()), [route]);
  // A link straight to the templates, such as the one on a Get ready step.
  useEffect(() => {
    const open = (): void => {
      if (/^#\/?policies\/templates/.test(window.location.hash)) setPolicyTab("templates");
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  const toggleSidebar = (): void =>
    setCollapsed((was) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, was ? "0" : "1");
      } catch {
        /* private window or blocked storage: it simply is not remembered */
      }
      return !was;
    });

  /** The version this server is running, shown at the top of Help. */
  const [version, setVersion] = useState("");
  useEffect(() => {
    let live = true;
    health()
      .then((h) => live && setVersion(h.version))
      .catch(() => { /* the menu simply shows no version */ });
    return () => { live = false; };
  }, []);

  /**
   * Whether the scrolling part of the menu has more below what is showing, so
   * its foot can fade. Without a hint, a menu cut off by the window looks like
   * a complete one.
   */
  const navRef = useRef<HTMLElement | null>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return undefined;
    const check = (): void => setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    check();
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [ready, user, meta, collapsed]);

  // Restore the session, if there is one, before deciding what to draw.
  useEffect(() => {
    let live = true;
    Promise.all([
      auth.me().then((r) => r.user).catch(() => null),
      pack.meta(),
      pack.themes(),
    ])
      .then(([sessionUser, packMeta, themes]) => {
        if (!live) return;
        setUser(sessionUser);
        setMeta({ pack: packMeta, themes });
        if (!sessionUser) {
          return auth.bootstrapNeeded().then((r) => live && setNeedsBootstrap(r.needsBootstrap));
        }
        return undefined;
      })
      .finally(() => live && setReady(true));
    return () => { live = false; };
  }, []);

  /**
   * The pick-lists every register links against.
   *
   * Controls are fetched once: they do not change while somebody works. Risks
   * are fetched again every time a screen opens, and after anything is added
   * from a sample library. Fetched only at sign-in, a risk added since then
   * never reached the "Add a link" lists, and a register that was empty at
   * sign-in left them empty for the whole session.
   */
  useEffect(() => {
    // Nothing loads for a session that must choose a password first; the
    // server would refuse it all anyway.
    if (!user || user.mustChangePassword) return;
    let live = true;
    controlsApi.list()
      .then((c) => {
        if (!live) return;
        setLinkOptions((cur) => ({
          ...cur,
          controls: c.controls.map((x) => ({ id: x.id, label: x.ref, detail: x.title })),
        }));
      })
      .catch(() => { /* the registers still work, just without pick-lists */ });
    return () => { live = false; };
  }, [user]);

  useEffect(() => {
    if (!user || user.mustChangePassword) return;
    let live = true;
    risksApi.list()
      .then((r) => {
        if (!live) return;
        setLinkOptions((cur) => ({
          ...cur,
          risks: r.risks.map((x) => ({ id: x.id, label: `#${x.seq}`, detail: x.title })),
        }));
      })
      .catch(() => { /* the registers still work, just without pick-lists */ });
    return () => { live = false; };
  }, [user, route, addedCount]);

  // Arriving at a screen - by the menu, a link or a bookmark - opens the
  // section it is in, so the menu never hides where you are.
  useEffect(() => {
    const here = NAV_SECTIONS.find((s) => (s.routes as readonly string[]).includes(route));
    if (here) setSections((cur) => (cur[here.id] === true ? cur : { ...cur, [here.id]: true }));
  }, [route]);

  useEffect(() => {
    const onHash = (): void => {
      setRoute(routeFromHash());
      setSubTab(subTabFromHash());
    };
    window.addEventListener("hashchange", onHash);
    // The API client fires this when the server rejects a session as expired.
    const onSignedOut = (): void => setUser(null);
    window.addEventListener("offset:signed-out", onSignedOut);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("offset:signed-out", onSignedOut);
    };
  }, []);

  if (!ready || !meta) return html`<div class="center muted">Loading…</div>`;

  if (!user) {
    return html`<${Login}
      needsBootstrap=${needsBootstrap}
      onSignedIn=${(u: SessionUser) => { setUser(u); setNeedsBootstrap(false); }}
    />`;
  }

  if (user.mustChangePassword) {
    return html`<${ChooseNewPassword}
      user=${user}
      onDone=${(u: SessionUser) => setUser(u)}
      onSignOut=${async () => { await auth.logout().catch(() => {}); setUser(null); }}
    />`;
  }

  const canEdit = user.role === "admin" || user.role === "contributor";
  const { themeLabel, itemLabel } = meta.pack;
  const features = meta.pack.features ?? {};

  /** One codebase, three products: a screen appears only if its pack asks for it. */
  const GATED: Partial<Record<Route, string>> = {
    getready: "journey",
    isms: "ismsScreen",
    profile: "tiers",
    soa: "statementOfApplicability",
    system: "baselines",
    vendors: "ismsRegisters",
    training: "ismsRegisters",
    objectives: "ismsRegisters",
    parties: "ismsRegisters",
    reviews: "ismsRegisters",
    communications: "ismsRegisters",
    gaps: "gapAnalysis",
    calendar: "calendar",
    help: "help",
    guides: "help",
  };
  const visible = ROUTES.filter((r) => {
    // User administration is for administrators only, so it is not even listed
    // for anyone else. The server refuses it regardless.
    if (r === "people" || r === "backups" || r === "settings" || r === "escalation") return user.role === "admin";
    // The trail is for the people who review it: administrators and auditors.
    if (r === "audit") return user.role === "admin" || user.role === "auditor";
    const flag = GATED[r];
    return flag ? Boolean(features[flag]) : true;
  });

  const TITLE: Record<Route, { h1: string; sub: string }> = {
    getready: { h1: "Get ready", sub: "What to do, in what order, and how far you have got" },
    thread: { h1: "Golden thread", sub: `Every risk, the ${plural(itemLabel).toLowerCase()} that treat it, and the evidence behind them` },
    dashboard: { h1: "Dashboard", sub: `${meta.pack.framework} readiness at a glance` },
    isms: { h1: "ISMS", sub: "Context, scope, risk method, objectives and certificate (clauses 4 to 6)" },
    profile: { h1: "Profile & Tiers", sub: "Where you are now, and where you intend to be" },
    soa: { h1: "Statement of Applicability", sub: "Which controls apply, and why the rest do not" },
    system: { h1: "System & Baseline", sub: "What you are authorising, and the controls that come with it" },
    controls: { h1: `${itemLabel} register`, sub: `All ${plural(itemLabel).toLowerCase()}, their status and owners` },
    evidence: { h1: "Evidence", sub: "Proof, who owns it, and how recent it is" },
    risks: { h1: "Risk register", sub: "Scored, treated, and linked to what mitigates them" },
    assets: { h1: "Asset register", sub: "What you hold, how critical it is, and who owns it" },
    policies: { h1: "Policies", sub: "Your scope, and the documents that sit under it" },
    tasks: { h1: "Tasks", sub: "The work outstanding, and who is doing it" },
    incidents: { h1: "Incidents", sub: "What happened, how bad, and where it stands" },
    findings: { h1: "Findings", sub: "Raised against you, and what closed them" },
    reports: { h1: "Reports", sub: "Download a PDF of where things stand" },
    vendors: { h1: "Suppliers", sub: "Who you rely on, what they hold, and what they showed you" },
    training: { h1: "Training", sub: "Who was trained, on what, and when it is due again" },
    objectives: { h1: "Objectives", sub: "What you are aiming at, and whether you are getting there" },
    parties: { h1: "Interested parties", sub: "Who cares about your security, and what they need" },
    reviews: { h1: "Audits and reviews", sub: "Internal audits and management reviews, planned and held" },
    communications: { h1: "Communications", sub: "Who is told what about security, when, and by whom" },
    escalation: { h1: "Escalation", sub: "Automatic reminders, and who is told when something is overdue" },
    gaps: { h1: "Gap analysis", sub: "What is left, and what is claimed without proof" },
    calendar: { h1: "Calendar", sub: "Everything with a date on it, in one place" },
    help: { h1: "Help", sub: "Short answers, and what each screen is for" },
    guides: { h1: "Documentation", sub: "The guides that ship with the product" },
    people: { h1: "Users", sub: "Who can sign in, and what they are allowed to do" },
    audit: { h1: "Audit trail", sub: "Who did what, and when. Nothing here can be changed" },
    backups: { h1: "Backups", sub: "Take one, keep them, and restore one if you need to" },
    settings: { h1: "Settings", sub: "How this instance is configured" },
  };

  const NAV_LABEL: Record<Route, string> = {
    getready: "Get ready",
    thread: "Golden thread",
    dashboard: "Dashboard",
    isms: "ISMS",
    profile: "Profile & Tiers",
    soa: "Applicability",
    system: "System & Baseline",
    controls: plural(itemLabel),
    evidence: "Evidence",
    risks: "Risks",
    assets: "Assets",
    policies: "Policies",
    tasks: "Tasks",
    incidents: "Incidents",
    findings: "Findings",
    reports: "Reports",
    vendors: "Suppliers",
    training: "Training",
    objectives: "Objectives",
    parties: "Interested parties",
    reviews: "Audits & reviews",
    communications: "Communications",
    escalation: "Escalation",
    gaps: "Gap analysis",
    calendar: "Calendar",
    help: "Help",
    guides: "Documentation",
    people: "Users",
    audit: "Audit trail",
    backups: "Backups",
    settings: "Settings",
  };

  return html`
    <div class=${`app${iconsOnly ? " nav-collapsed" : ""}`}>
      <aside class="sidebar">
        <div class="sidebar-head">
          ${iconsOnly
            ? html`<${ProductMark} cls="mark pmark" />`
            : html`<${Brand} onDark=${true} />`}
          <button type="button" class="collapse-btn" onClick=${toggleSidebar}
                  title=${collapsed ? "Show the menu" : "Hide the menu labels"}
                  aria-label=${collapsed ? "Show the menu" : "Hide the menu labels"}>
            <${Icon} name=${collapsed ? "expand" : "collapse"} />
          </button>
        </div>
        <nav ref=${navRef} class=${`nav scroll${moreBelow ? " more" : ""}`}>
          ${NAV_SECTIONS.map((s) => ({ ...s, items: s.routes.filter((r) => visible.includes(r) && !PINNED.includes(r)) }))
            .filter((s) => s.items.length > 0)
            .map((s) => html`
              <div class=${`nav-section${sectionOpen(s.id) ? "" : " closed"}`} key=${s.id}>
                <button type="button" class="nav-section-head" aria-expanded=${sectionOpen(s.id)}
                        onClick=${() => toggleSection(s.id)}>
                  <span>${s.title}</span>
                  <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </button>
                <div class="nav-items">
                  ${s.items.map((r) => html`
                    <a href=${`#/${r}`} class=${r === route ? "active" : ""}
                       title=${iconsOnly ? NAV_LABEL[r] : undefined}>
                      <${Icon} name=${r} /><span class="label">${NAV_LABEL[r]}</span>
                    </a>`)}
                </div>
              </div>`)}
        </nav>
        ${PINNED.some((r) => visible.includes(r))
          ? html`<nav class="nav pinned">
              ${PINNED.filter((r) => visible.includes(r)).map((r) => html`
                <a href=${`#/${r}`} class=${r === route ? "active" : ""}
                   title=${iconsOnly ? NAV_LABEL[r] : undefined}>
                  <${Icon} name=${r} /><span class="label">${NAV_LABEL[r]}</span>
                </a>`)}
            </nav>`
          : null}
        <div class="sidebar-user" title=${`${user.name} (${user.role})`}>
          <span class="avatar" aria-hidden="true">${initials(user.name)}</span>
          <span class="who-text"><b>${user.name}</b><em>${user.role}</em></span>
        </div>
        <div class="sidebar-foot muted">
          ${meta.pack.contact
            ? html`<div class="credit">Developed by Offset Security</div>
                <div class="contact"><span class="lead">${"Contact: "}</span><a
                href=${`mailto:${meta.pack.contact}`}>${meta.pack.contact}</a></div>`
            : null}
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <div>
            <h1>${TITLE[route].h1}</h1>
            <div class="sub">${TITLE[route].sub}</div>
          </div>
          <div class="who">
            <div>
              <div class="who-name">${user.name}</div>
              <div class="who-role muted">${user.role}</div>
            </div>
            <button class="btn" onClick=${() => setChangingPassword(true)}>
              Change password
            </button>
            <button class="btn" onClick=${async () => { await auth.logout().catch(() => {}); setUser(null); }}>
              Sign out
            </button>
          </div>
        </header>

        ${changingPassword
          ? html`<${ChangePasswordDialog} onClose=${() => setChangingPassword(false)} />`
          : null}

        <main class="content">
          ${!visible.includes(route)
            ? html`<div class="card pad muted">
                This screen is not part of ${meta.pack.product}.
              </div>`
            : route === "getready"
            ? html`<${Journey} canEdit=${canEdit} itemLabel=${itemLabel} />`
            // Never reached from the address any more ("#/thread" opens Risks on its
            // Golden thread tab), but kept so a route of that name still renders.
            : route === "thread"
            ? html`<${GoldenThread} itemLabel=${itemLabel} canEdit=${canEdit} clauses=${Boolean(features["isoClauses"])}
                 reasons=${Boolean(features["statementOfApplicability"])} />`
            : route === "profile"
            ? html`<${Profile} canEdit=${canEdit} itemLabel=${itemLabel} />`
            : route === "soa"
            ? html`<${Soa} themes=${meta.themes} itemLabel=${itemLabel}
                           canEdit=${canEdit} pack=${meta.pack} />`
            : route === "system"
            ? html`<${Baseline} canEdit=${canEdit} itemLabel=${itemLabel} />`
            : route === "reports"
            ? html`<${Reports} isAdmin=${user.role === "admin"} />`
            : route === "people"
            ? html`<${Users} me=${user} />`
            : route === "gaps"
            ? html`<${Gaps} themes=${meta.themes} itemLabel=${itemLabel}
                     canEdit=${canEdit} pack=${meta.pack} />`
            : route === "calendar"
            ? html`<${Calendar} />`
            : route === "help" || route === "guides"
            ? html`<${Help} kind=${route === "help" ? "help" : "guides"} version=${version} />`
            : route === "findings" && features["ismsRegisters"]
            // Corrective action lives on the finding, so the register gains
            // fields rather than the product gaining a screen.
            ? html`<${Register} csv=${Boolean(features["csv"])} spec=${findingRegisterWithCorrectiveAction}
                     canEdit=${canEdit} links=${linkOptions} />`
            : route === "audit"
            ? html`<${AuditTrail} itemLabel=${itemLabel} />`
            : route === "backups"
            ? html`<${Backups} onRestored=${() => { window.location.hash = "#/dashboard"; window.location.reload(); }} />`
            : route === "settings"
            ? html`<${Settings} me=${user} features=${features} />`
            : route === "dashboard"
            ? html`<${Dashboard} themes=${meta.themes} themeLabel=${themeLabel}
                                 itemLabel=${itemLabel} pack=${meta.pack} />`
            : route === "controls"
            ? html`<${Controls} themes=${meta.themes} themeLabel=${themeLabel}
                                itemLabel=${itemLabel} canEdit=${canEdit} pack=${meta.pack} />`
            : route === "isms"
            ? html`<${Isms} canEdit=${canEdit} />`
            : route === "escalation"
            ? html`<${Escalation} canEdit=${canEdit} />`
            : route === "evidence"
            ? html`<${Evidence} itemLabel=${itemLabel} canEdit=${canEdit} />`
            : route === "risks" || route === "assets"
            // The two registers a customer has to fill from nothing. A sub-tab
            // rather than a screen of its own: samples are a way of filling in
            // a register, not a separate thing to manage.
            ? html`<>
                <div class="sub-tabs">
                  <button type="button"
                    class=${subTab === "register" ? "sel" : ""}
                    onClick=${() => pickTab("register")}>Register</button>
                  <button type="button"
                    class=${subTab === "samples" ? "sel" : ""}
                    onClick=${() => pickTab("samples")}>Sample library</button>
                  ${route === "risks" && visible.includes("thread")
                    // The thread follows each risk to the controls that treat it and the
                    // evidence behind them, so it lives with the risks.
                    ? html`<button type="button"
                        class=${subTab === "thread" ? "sel" : ""}
                        onClick=${() => pickTab("thread")}>Golden thread</button>`
                    : null}
                </div>
                ${subTab === "thread" && route === "risks"
                  ? html`<${GoldenThread} itemLabel=${itemLabel} canEdit=${canEdit} clauses=${Boolean(features["isoClauses"])}
                 reasons=${Boolean(features["statementOfApplicability"])} />`
                  : subTab === "samples"
                  ? html`<${SampleLibrary} kind=${route} canEdit=${canEdit} controls=${linkOptions["controls"] ?? []}
                           onAdded=${() => setAddedCount((n) => n + 1)} />`
                  : route === "risks"
                    ? html`<${Risks} key=${addedCount} canEdit=${canEdit} controls=${linkOptions["controls"] ?? []} itemLabel=${itemLabel.toLowerCase()} />`
                    : html`<${Register} csv=${Boolean(features["csv"])} key=${addedCount} spec=${REGISTERS[route]}
                             canEdit=${canEdit} links=${linkOptions} />`}
              </>`
            : route === "policies"
            // Scope is a written statement about the whole programme, so it
            // belongs with the documents rather than with the mail server
            // settings. It also frees it from Settings' admin-only gate: the
            // API has always allowed a contributor to write it.
            ? html`<>
                ${features["ismsScreen"]
                  // Scope has its own home on the ISMS screen in a product that has one.
                  ? null
                  : html`<${Programme} canEdit=${canEdit} />`}
                ${features["policyTemplates"]
                  // Starter documents are a way of filling in the register,
                  // like the sample library, so they sit beside it rather than
                  // taking a place in the menu of their own.
                  ? html`<div class="sub-tabs" style="margin-top:16px">
                      <button type="button"
                        class=${policyTab === "documents" ? "sel" : ""}
                        onClick=${() => setPolicyTab("documents")}>Documents</button>
                      <button type="button"
                        class=${policyTab === "templates" ? "sel" : ""}
                        onClick=${() => setPolicyTab("templates")}>Templates</button>
                    </div>`
                  : null}
                <div style="margin-top:16px">
                  ${features["policyTemplates"] && policyTab === "templates"
                    ? html`<${Templates} canEdit=${canEdit} />`
                    : html`<${Register} csv=${Boolean(features["csv"])} spec=${REGISTERS[route]} canEdit=${canEdit}
                             links=${linkOptions} />`}
                </div>
              </>`
            : route in REGISTER_SAMPLES
            // Suppliers, interested parties, objectives and training get the
            // same Register / Sample library pair as assets and risks.
            ? html`<>
                <div class="sub-tabs">
                  <button type="button"
                    class=${subTab === "register" ? "sel" : ""}
                    onClick=${() => pickTab("register")}>Register</button>
                  <button type="button"
                    class=${subTab === "samples" ? "sel" : ""}
                    onClick=${() => pickTab("samples")}>Sample library</button>
                </div>
                ${subTab === "samples"
                  ? html`<${RegisterSamples} kind=${route} spec=${REGISTERS[route as keyof typeof REGISTERS]}
                           canEdit=${canEdit} onAdded=${() => setAddedCount((n) => n + 1)} />`
                  : html`<${Register} csv=${Boolean(features["csv"])} key=${addedCount}
                           spec=${REGISTERS[route as keyof typeof REGISTERS]} canEdit=${canEdit} links=${linkOptions} />`}
              </>`
            : html`<${Register} csv=${Boolean(features["csv"])} spec=${REGISTERS[route]} canEdit=${canEdit} links=${linkOptions} />`}
        </main>
      </div>
    </div>`;
}
