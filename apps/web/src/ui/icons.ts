import { h, type VNode } from "preact";

/**
 * Line icons for the menu.
 *
 * Drawn here rather than taken from an icon package, so the page still loads
 * nothing it did not ship and the CSP stays as strict as it is. Each is a few
 * shapes on a 24-unit grid, stroked in the text colour, so an icon dims and
 * brightens with the menu item it sits in.
 */
type Shape =
  | ["path", { d: string }]
  | ["circle", { cx: number; cy: number; r: number }]
  | ["rect", { x: number; y: number; width: number; height: number; rx?: number }];

export const ICON_SHAPES = {
  // Get ready: a flag at the end of the route
  getready: [["path", { d: "M5 21V4" }], ["path", { d: "M5 4h12l-2.5 4.5L17 13H5" }]],
  // Golden thread: three points joined by one line
  thread: [
    ["circle", { cx: 5, cy: 6, r: 2 }],
    ["circle", { cx: 12, cy: 12, r: 2 }],
    ["circle", { cx: 19, cy: 18, r: 2 }],
    ["path", { d: "M7 6.5c3 0 2 5.5 3 5.5m4 0c1 0 0 5.5 3 5.5" }],
  ],
  // Dashboard: four tiles
  dashboard: [
    ["rect", { x: 3, y: 3, width: 7, height: 9, rx: 1.5 }],
    ["rect", { x: 14, y: 3, width: 7, height: 5, rx: 1.5 }],
    ["rect", { x: 14, y: 12, width: 7, height: 9, rx: 1.5 }],
    ["rect", { x: 3, y: 16, width: 7, height: 5, rx: 1.5 }],
  ],
  // Escalation: a bell
  escalation: [
    ["path", { d: "M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" }],
    ["path", { d: "M10 20a2 2 0 0 0 4 0" }],
  ],
  // ISMS: three stacked layers
  isms: [
    ["path", { d: "m12 3 9 4.5-9 4.5-9-4.5Z" }],
    ["path", { d: "m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" }],
  ],
  // Profile & Tiers: rising steps
  profile: [["path", { d: "M3 21h18" }], ["path", { d: "M5 21v-5h4v5M10 21v-9h4v9M15 21V7h4v14" }]],
  // Applicability: a clipboard with a tick
  soa: [
    ["rect", { x: 5, y: 4, width: 14, height: 17, rx: 2 }],
    ["path", { d: "M9 4V3h6v1" }],
    ["path", { d: "m9 13 2 2 4-4" }],
  ],
  // System & Baseline: a server
  system: [
    ["rect", { x: 3, y: 4, width: 18, height: 7, rx: 2 }],
    ["rect", { x: 3, y: 13, width: 18, height: 7, rx: 2 }],
    ["path", { d: "M7 7.5h.01M7 16.5h.01" }],
  ],
  // Controls: a shield with a tick
  controls: [
    ["path", { d: "M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" }],
    ["path", { d: "m9 12 2 2 4-4" }],
  ],
  // Evidence: a paperclip
  evidence: [["path", { d: "m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L14.5 7" }]],
  // Risks: a warning triangle
  risks: [
    ["path", { d: "M10.3 3.9 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" }],
    ["path", { d: "M12 9v4M12 17h.01" }],
  ],
  // Assets: a box
  assets: [
    ["path", { d: "M21 8 12 3 3 8v8l9 5 9-5V8Z" }],
    ["path", { d: "m3 8 9 5 9-5M12 13v8" }],
  ],
  // Policies: a page of text
  policies: [
    ["path", { d: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" }],
    ["path", { d: "M14 3v5h5M9 13h6M9 17h6" }],
  ],
  // Tasks: a ticked list
  tasks: [
    ["path", { d: "m3 6 1.5 1.5L7 5M3 13l1.5 1.5L7 12" }],
    ["path", { d: "M11 6h10M11 13h10M11 20h10M4 20h.01" }],
  ],
  // Incidents: a siren
  incidents: [
    ["path", { d: "M7 18v-6a5 5 0 0 1 10 0v6" }],
    ["path", { d: "M5 21h14v-3H5v3ZM12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4" }],
  ],
  // Findings: a magnifying glass
  findings: [["circle", { cx: 11, cy: 11, r: 7 }], ["path", { d: "m21 21-4.3-4.3" }]],
  // Reports: a chart on a page
  reports: [
    ["path", { d: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" }],
    ["path", { d: "M9 17v-3M12 17v-6M15 17v-2" }],
  ],
  // Gap analysis: a circle not yet closed
  gaps: [["path", { d: "M21 12a9 9 0 1 1-9-9" }], ["path", { d: "M12 7v5l3 2M16 3.5l1 1M19.5 7l1 1" }]],
  // Suppliers: a delivery truck
  vendors: [
    ["path", { d: "M3 6h11v10H3zM14 10h4l3 3v3h-7" }],
    ["circle", { cx: 7, cy: 18, r: 2 }],
    ["circle", { cx: 17, cy: 18, r: 2 }],
  ],
  // Training: a graduation cap
  training: [["path", { d: "M22 9 12 4 2 9l10 5 10-5Z" }], ["path", { d: "M6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6" }]],
  // Objectives: a target
  objectives: [
    ["circle", { cx: 12, cy: 12, r: 9 }],
    ["circle", { cx: 12, cy: 12, r: 5 }],
    ["circle", { cx: 12, cy: 12, r: 1 }],
  ],
  // Interested parties: two people
  parties: [
    ["circle", { cx: 9, cy: 8, r: 3.5 }],
    ["path", { d: "M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" }],
  ],
  // Audits & reviews: a clipboard with lines
  reviews: [
    ["rect", { x: 5, y: 4, width: 14, height: 17, rx: 2 }],
    ["path", { d: "M9 4V3h6v1M9 10h6M9 14h6M9 18h3" }],
  ],
  // Communications: a speech bubble with lines
  communications: [
    ["path", { d: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4V6Z" }],
    ["path", { d: "M8 8h8M8 12h5" }],
  ],
  // Calendar
  calendar: [
    ["rect", { x: 3, y: 5, width: 18, height: 16, rx: 2 }],
    ["path", { d: "M3 10h18M8 3v4M16 3v4" }],
  ],
  // Help: a question mark in a circle
  help: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M9.5 9.5a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7M12 17h.01" }]],
  // Documentation: an open book
  guides: [
    ["path", { d: "M2 5h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2V5Z" }],
    ["path", { d: "M22 5h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7V5Z" }],
  ],
  // Users: one person
  people: [["circle", { cx: 12, cy: 8, r: 4 }], ["path", { d: "M4 21a8 8 0 0 1 16 0" }]],
  // Audit trail: a list with a clock beside it
  audit: [
    ["path", { d: "M4 6h9M4 11h6M4 16h5" }],
    ["circle", { cx: 16.5, cy: 15.5, r: 4.5 }],
    ["path", { d: "M16.5 13.5v2l1.5 1" }],
  ],
  // Backups: a database
  backups: [
    ["path", { d: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z" }],
    ["path", { d: "M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" }],
  ],
  // Hide the menu labels, and show them again
  collapse: [["path", { d: "m11 17-5-5 5-5M18 17l-5-5 5-5" }]],
  expand: [["path", { d: "m13 17 5-5-5-5M6 17l5-5-5-5" }]],
  // Settings: sliders
  settings: [
    ["path", { d: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" }],
    ["circle", { cx: 15, cy: 6, r: 2 }],
    ["circle", { cx: 9, cy: 12, r: 2 }],
    ["circle", { cx: 17, cy: 18, r: 2 }],
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICON_SHAPES;

export function Icon({ name }: { name: IconName }): VNode {
  const shapes = ICON_SHAPES[name] as Shape[];
  return h(
    "svg",
    {
      class: "icon",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.75,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    },
    shapes.map(([tag, attrs]) => h(tag, attrs)),
  );
}
