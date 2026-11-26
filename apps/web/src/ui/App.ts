import { useEffect, useRef, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { WalkBar } from "./AuditorWalk.js";

import {
  auth, health, pack, controls as controlsApi, risks as risksApi,
  type Pack, type SessionUser,
} from "../persistence/apiClient.js";
import { Brand, ProductMark } from "./Brand.js";
import { Icon, type IconName } from "./icons.js";
import { Login } from "./Login.js";
import { ChangePasswordDialog, ChooseNewPassword } from "./ChangePassword.js";
import { CommandPalette, type PaletteItem } from "./CommandPalette.js";
import { Dashboard } from "./Dashboard.js";
import { AuditorView } from "./AuditorView.js";
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
  "escalation", "calendar", "auditor",
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
  // The plan and the overview: where every session starts. No heading, always open.
  { id: "start", title: "", routes: ["getready", "dashboard"] },
  // The programme the certificate is made of, in the order it is built.
  { id: "compliance", title: "Programme", routes: ["isms", "profile", "soa", "system", "controls", "policies", "evidence"] },
  { id: "risk", title: "Risk", routes: ["risks", "assets", "thread", "vendors"] },
  // The work of running the programme week to week.
  { id: "work", title: "Operations", routes: ["tasks", "calendar", "incidents"] },
  // Facing the auditor.
  { id: "reports", title: "Audit", routes: ["auditor", "reviews", "findings", "gaps", "reports"] },
  { id: "management", title: "Governance", routes: ["training", "objectives", "parties", "communications"] },
  { id: "admin", title: "Administration", routes: ["people", "escalation", "audit", "backups"] },
];

/**
 * Icons-only, each section is one button: its own icon, a panel of its screens
 * on click. Folding sections behind tiny chevrons in a 60-pixel strip hid the
 * page you were on and left rows of lines with nothing under them.
 */
const SECTION_ICON: Record<string, IconName> = {
  compliance: "controls", risk: "risks", work: "tasks", reports: "reports", management: "objectives", admin: "people",
};

/** Which sections are open by default: Start, and the work people use every week. */
const OPEN_BY_DEFAULT = new Set(["start", "compliance"]);

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

/** The palette shortcut as this keyboard writes it. */
const KEY_HINT = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "\u2318K" : "Ctrl K";

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
// Below 1100 px the menu is icons (1280 and 1366 laptops keep the full menu).
const NARROW = "(max-width: 1099px)";
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
  // The Golden thread was once a tab of Risks; "#/risks/thread" from an old link still finds it.
  if (/^#\/?risks\/thread\b/.test(window.location.hash)) return "thread";
  return (ROUTES as readonly string[]).includes(key) ? (key as Route) : "dashboard";
};

type SubTab = "register" | "samples";

/** A register always opens on its entries. */
const subTabFromHash = (): SubTab => "register";

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
  const pickTab = (tab: SubTab): void => setSubTab(tab);
  /** Documents, or the templates that ship with the pack. */
  const [policyTab, setPolicyTab] = useState<"documents" | "templates">("documents");
  // Bumped when the auditor walk-through is ended, so its bar goes at once.
  const [, setWalkEnded] = useState(0);
  const [addedCount, setAddedCount] = useState(0);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [meta, setMeta] = useState<{ pack: Pack; themes: Record<string, string> } | null>(null);
  const [route, setRoute] = useState<Route>(routeFromHash());
  const [ready, setReady] = useState(false);
  const [linkOptions, setLinkOptions] = useState<Record<string, LinkOption[]>>({});
  const [changingPassword, setChangingPassword] = useState(false);
  /** The jump-to palette (Ctrl K) and the account menu in the top bar. */
  const [palette, setPalette] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); }
      if (e.key === "Escape") setAcctOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!acctOpen) return undefined;
    const close = (e: MouseEvent): void => { if (!(e.target as HTMLElement).closest(".acct")) setAcctOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [acctOpen]);
  useEffect(() => setAcctOpen(false), [route]);
  const [flyout, setFlyout] = useState<{ id: string; top: number; left: number } | null>(null);
  useEffect(() => setFlyout(null), [route]);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [sections, setSections] = useState<Record<string, boolean>>(readSections);
  const sectionOpen = (id: string): boolean => sections[id] ?? OPEN_BY_DEFAULT.has(id);
  /** The section opened last: the menu keeps it open when it folds the others. */
  const lastOpened = useRef<string | null>(null);
  const toggleSection = (id: string): void =>
    setSections((cur) => {
      const next = { ...cur, [id]: !(cur[id] ?? OPEN_BY_DEFAULT.has(id)) };
      if (next[id]) lastOpened.current = id;
      try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch { /* a private window */ }
      return next;
    });
  const narrow = useNarrow();
  const iconsOnly = collapsed || narrow;
  // Each register opens on its entries, not on whichever tab the last one was left
  // on - unless the address names a tab, as a link to the Golden thread does.
  useEffect(() => setSubTab(subTabFromHash()), [route]);
  // A link straight to the templates, such as the one on a Plan step.
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

  /**
   * The menu never scrolls inside itself. When the open sections would not
   * fit, the others fold, keeping the section of the page you are on and the
   * one you opened last. Folding here is not saved: on a taller window the
   * sections you chose open again.
   */
  const [fitTick, setFitTick] = useState(0);
  useEffect(() => {
    const onResize = (): void => setFitTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    const el = navRef.current;
    if (iconsOnly) return;
    if (!el || el.scrollHeight <= el.clientHeight + 1) return;
    const keep = new Set<string>();
    el.querySelectorAll<HTMLElement>(".nav-section[data-current='1']").forEach((s) => keep.add(s.dataset["id"] ?? ""));
    if (lastOpened.current) keep.add(lastOpened.current);
    const open = [...el.querySelectorAll<HTMLElement>(".nav-section:not(.closed)")].map((s) => s.dataset["id"] ?? "").filter(Boolean);
    // The first section has no heading to open it again with, so it never folds.
    let fold = open.filter((id) => !keep.has(id) && id !== "start");
    // Still too tall with two open: keep only the one just opened. The page you
    // are on is still named in the top bar.
    if (!fold.length && lastOpened.current && open.length > 1) fold = open.filter((id) => id !== lastOpened.current && id !== "start");
    if (!fold.length) return;
    setSections((cur) => {
      const next = { ...cur };
      for (const id of fold) next[id] = false;
      return next;
    });
  }, [sections, route, collapsed, fitTick, ready, user]);

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
    getready: { h1: "Plan", sub: "What to do, in what order, and how far you have got" },
    thread: { h1: "Golden thread", sub: `Every risk, the ${plural(itemLabel).toLowerCase()} that treat it, and the evidence behind them` },
    dashboard: {
      h1: "Dashboard",
      sub: features["readiness"] && meta.pack.readiness
        ? `Your ${meta.pack.readiness.keyDate} date, what the ${meta.pack.readiness.auditorShort} would find, and where you stand`
        : `${meta.pack.framework} readiness at a glance`,
    },
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
    auditor: { h1: "Auditor view", sub: "One page to walk your certification auditor through, in the order an ISO/IEC 27001 audit reads" },
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
    getready: "Plan",
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
    auditor: "Auditor view",
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

  const navSections = NAV_SECTIONS.map((sec) => ({ ...sec, items: sec.routes.filter((r) => visible.includes(r) && !PINNED.includes(r)) }))
    .filter((sec) => sec.items.length > 0);
  /** The section a screen sits in, named above its title. */
  const sectionOf = (r: Route): string => NAV_SECTIONS.find((sec) => (sec.routes as readonly string[]).includes(r))?.title ?? "";
  const signOut = async (): Promise<void> => { await auth.logout().catch(() => {}); setUser(null); };
  const go = (r: Route): void => { window.location.hash = `#/${r}`; };
  const paletteItems: PaletteItem[] = [
    ...NAV_SECTIONS.flatMap((sec) => sec.routes.filter((r) => visible.includes(r) && !PINNED.includes(r))
      .map((r) => ({ id: r, label: NAV_LABEL[r], group: sec.title || "Start", icon: r as IconName, hint: TITLE[r].sub, run: () => go(r) }))),
    ...PINNED.filter((r) => visible.includes(r))
      .map((r) => ({ id: r, label: NAV_LABEL[r], group: "Help and settings", icon: r as IconName, hint: TITLE[r].sub, run: () => go(r) })),
    { id: "act-password", label: "Change password", group: "Account", icon: "key" as IconName, run: () => setChangingPassword(true) },
    { id: "act-signout", label: "Sign out", group: "Account", icon: "logout" as IconName, run: () => { void signOut(); } },
  ];

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
        <button type="button" class="jump" onClick=${() => setPalette(true)} title=${`Jump to a screen (${KEY_HINT})`} aria-label="Jump to a screen">
          <${Icon} name="search" /><span>Jump to…</span><kbd>${KEY_HINT}</kbd>
        </button>
        ${iconsOnly
          ? html`<nav ref=${navRef} class="nav scroll rail" aria-label="Screens">
              ${navSections.map((s) => !s.title
                ? s.items.map((r) => html`
                    <a href=${`#/${r}`} key=${r} class=${r === route ? "active" : ""} aria-current=${r === route ? "page" : undefined}
                       title=${NAV_LABEL[r]}><${Icon} name=${r} /><span class="label">${NAV_LABEL[r]}</span></a>`)
                : html`<button type="button" key=${s.id}
                      class=${`rail-btn${s.items.includes(route) ? " current" : ""}${flyout?.id === s.id ? " open" : ""}`}
                      aria-haspopup="menu" aria-expanded=${flyout?.id === s.id} aria-label=${s.title} title=${s.title}
                      onClick=${(e: MouseEvent) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setFlyout((f) => (f?.id === s.id ? null : { id: s.id, top: r.top, left: r.right + 10 }));
                      }}>
                    <${Icon} name=${SECTION_ICON[s.id] ?? s.items[0]!} />
                  </button>`)}
            </nav>`
          : html`<nav ref=${navRef} class=${`nav scroll${moreBelow ? " more" : ""}`} aria-label="Screens">
          ${navSections.map((s) => html`
              <div class=${`nav-section${!s.title || sectionOpen(s.id) ? "" : " closed"}`} key=${s.id}
                   data-id=${s.id} data-current=${s.items.includes(route) ? "1" : "0"}>
                ${s.title
                  ? html`<button type="button" class="nav-section-head" aria-expanded=${sectionOpen(s.id)}
                        aria-label=${s.title}
                        onClick=${() => toggleSection(s.id)}>
                      <span>${s.title}</span>
                      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
                           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                    </button>`
                  : null}
                <div class="nav-items">
                  ${s.items.map((r) => html`
                    <a href=${`#/${r}`} class=${r === route ? "active" : ""} aria-current=${r === route ? "page" : undefined}
                       title=${iconsOnly ? NAV_LABEL[r] : undefined}>
                      <${Icon} name=${r} /><span class="label">${NAV_LABEL[r]}</span>
                    </a>`)}
                </div>
              </div>`)}
        </nav>`}
        ${PINNED.some((r) => r !== "help" && visible.includes(r))
          ? html`<nav class="nav pinned" aria-label="Settings and documentation">
              ${PINNED.filter((r) => r !== "help" && visible.includes(r)).map((r) => html`
                <a href=${`#/${r}`} class=${r === route ? "active" : ""} aria-current=${r === route ? "page" : undefined}
                   title=${iconsOnly ? NAV_LABEL[r] : undefined}>
                  <${Icon} name=${r} /><span class="label">${NAV_LABEL[r]}</span>
                </a>`)}
            </nav>`
          : null}
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
          <div class="topbar-title">
            ${sectionOf(route) ? html`<div class="crumb">${sectionOf(route)}</div>` : null}
            <h1>${TITLE[route].h1}</h1>
            <div class="sub" title=${TITLE[route].sub}>${TITLE[route].sub}</div>
          </div>
          <div class="who">
            ${visible.includes("help")
              ? html`<a class="icon-btn help" href="#/help" title="Help" aria-label="Help"><${Icon} name="help" /></a>`
              : null}
            <div class="acct">
              <button type="button" class="acct-btn" aria-haspopup="menu" aria-expanded=${acctOpen}
                      aria-label=${`Account: ${user.name}`} onClick=${() => setAcctOpen((v) => !v)}>
                <span class="avatar" aria-hidden="true">${initials(user.name)}</span>
                <span class="who-text">
                  <div class="who-name">${user.name}</div>
                  <div class="who-role">${user.role}</div>
                </span>
                <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
              </button>
              ${acctOpen
                ? html`<div class="menu" role="menu">
                    <div class="menu-head"><b>${user.name}</b><span>${user.username} · <span style="text-transform:capitalize;display:inline">${user.role}</span></span></div>
                    <button type="button" role="menuitem" onClick=${() => { setAcctOpen(false); setChangingPassword(true); }}>
                      <${Icon} name="key" />Change password
                    </button>
                    <button type="button" role="menuitem" onClick=${() => { setAcctOpen(false); setPalette(true); }}>
                      <${Icon} name="search" />Jump to a screen<kbd style="margin-left:auto">${KEY_HINT}</kbd>
                    </button>
                    <div class="sep"></div>
                    <button type="button" role="menuitem" onClick=${() => { void signOut(); }}>
                      <${Icon} name="logout" />Sign out
                    </button>
                  </div>`
                : null}
            </div>
          </div>
        </header>

        ${changingPassword
          ? html`<${ChangePasswordDialog} onClose=${() => setChangingPassword(false)} />`
          : null}
        ${palette ? html`<${CommandPalette} items=${paletteItems} onClose=${() => setPalette(false)} />` : null}
        ${flyout && iconsOnly
          ? (() => {
              const sec = navSections.find((x) => x.id === flyout.id);
              if (!sec) return null;
              const top = Math.max(8, Math.min(flyout.top - 8, window.innerHeight - (sec.items.length * 36 + 60)));
              return html`<div class="nav-flyout" role="menu" aria-label=${sec.title} style=${`top:${top}px;left:${flyout.left}px`}>
                <div class="nav-flyout-h">${sec.title}</div>
                ${sec.items.map((r) => html`
                  <a role="menuitem" key=${r} href=${`#/${r}`} class=${r === route ? "active" : ""}
                     aria-current=${r === route ? "page" : undefined} onClick=${() => setFlyout(null)}>
                    <${Icon} name=${r} /><span>${NAV_LABEL[r]}</span>
                  </a>`)}
              </div>`;
            })()
          : null}

        <main class="content" key=${route}>
          ${route !== "auditor" ? html`<${WalkBar} onEnd=${() => setWalkEnded((n) => n + 1)} />` : null}
          ${!visible.includes(route)
            ? html`<div class="card pad muted">
                This screen is not part of ${meta.pack.product}.
              </div>`
            : route === "getready"
            ? html`<${Journey} canEdit=${canEdit} itemLabel=${itemLabel} ready=${Boolean(features["readiness"])}
                 themes=${meta.themes} allowOut=${Boolean(features["statementOfApplicability"])} />`
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
            ? html`<${Reports} isAdmin=${user.role === "admin"} board=${Boolean(features["boardReport"])}
                             scored=${Boolean(features["maturity"])} />`
            : route === "people"
            ? html`<${Users} me=${user} />`
            : route === "auditor"
            ? html`<${AuditorView} framework=${meta.pack.framework} isAuditor=${user.role === "auditor"}
                     canSeeTrail=${user.role === "admin" || user.role === "auditor"} />`
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
                                 itemLabel=${itemLabel} pack=${meta.pack} name=${user.name} />`
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
                </div>
                ${subTab === "samples"
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
