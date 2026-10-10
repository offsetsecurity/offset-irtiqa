/**
 * The single seam between the SPA and the server.
 *
 * The existing single-file tool kept everything in one `DB` object and called
 * `save()` after each change. That contract is preserved here — the difference
 * is that `save()` now performs a scoped write to the API instead of dumping
 * the whole object into localStorage.
 */

export interface ApiError extends Error {
  status: number;
  detail?: unknown;
}

const CSRF_COOKIE = "offset_csrf";
const CSRF_HEADER = "x-csrf-token";

function csrfToken(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers[CSRF_HEADER] = csrfToken();

  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    // The page and the server are served by the same process, but the page is
    // read from disk on each request while the routes were fixed when the
    // process started. So an updated build that has not been restarted yet
    // serves new screens against an old API, and every call to a route added
    // since start-up 404s. "No such endpoint" is true but useless; say what to
    // actually do about it.
    const staleServer = response.status === 404 && payload.error === "No such endpoint.";
    const message = staleServer
      ? "This screen needs a newer version of the server than the one running. Restart the application and reload this page."
      : (payload.error ?? `Request failed (${response.status})`);

    const err = new Error(message) as ApiError;
    err.status = response.status;
    err.detail = payload.detail;
    // The session expired or was revoked — the shell listens for this.
    if (response.status === 401) window.dispatchEvent(new CustomEvent("offset:signed-out"));
    throw err;
  }

  return payload as T;
}

/**
 * The same thing for a file.
 *
 * Deliberately does not set content-type: the browser has to add the
 * multipart boundary itself, and setting it by hand produces a body the
 * server cannot parse. Everything else — CSRF, credentials, the error
 * handling above — is shared.
 */
async function upload<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json", [CSRF_HEADER]: csrfToken() },
    credentials: "same-origin",
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(
      payload.error ?? `Upload failed (${response.status})`,
    ) as ApiError;
    err.status = response.status;
    if (response.status === 401) window.dispatchEvent(new CustomEvent("offset:signed-out"));
    throw err;
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, body: FormData) => upload<T>(path, body),
};

// ── typed endpoints ─────────────────────────────────────────────────────────

export type ControlStatus = "not_started" | "in_progress" | "implemented" | "not_applicable";

export interface Control {
  id: string;
  ref: string;
  title: string;
  theme: string;
  parent_ref: string | null;
  status: ControlStatus;
  /** SAMA-style maturity, 0-5. Null means nobody has scored it yet. */
  maturity: number | null;
  target_maturity: number | null;
  /** When the work on this control is due. Null means nobody set a date. */
  due_date: string | null;
  /** Where reminders go. Empty means this control chases nobody. */
  owner_email: string | null;
  owner: string;
  notes: string;
  mapped: string;
  justification: string;
  attrs: Record<string, unknown>;
  updated_at: string;
  /** How many evidence items are linked. Present on the list, not on a single control. */
  evidence_count?: number;
}

/** What a caller may change about a control. Row shape, not body shape. */
export type ControlPatch = Partial<
  Pick<
    Control,
    | "status"
    | "owner"
    | "notes"
    | "mapped"
    | "justification"
    | "attrs"
    | "maturity"
    | "target_maturity"
    | "due_date"
    | "owner_email"
  >
>;

/**
 * One column is spelled two ways and the difference is not cosmetic: the row
 * comes back as `target_maturity` and the API only accepts `targetMaturity`,
 * rejecting the other outright. Screens hold rows, so they naturally send the
 * row spelling; translating here means one place knows, rather than every
 * component that touches a target. Same reasoning as `toRiskBody` below.
 */
function toControlBody(patch: ControlPatch): Record<string, unknown> {
  const { target_maturity: target, due_date: due, owner_email: email, ...rest } = patch;
  const body: Record<string, unknown> = { ...rest };
  if ("target_maturity" in patch) body["targetMaturity"] = target;
  if ("due_date" in patch) body["dueDate"] = due;
  if ("owner_email" in patch) body["ownerEmail"] = email;
  return body;
}

/**
 * The readiness plan, and where the customer has got to with it.
 *
 * `automatic` says who decided: the product looked at its own data, or a
 * person ticked it. The screen shows the difference, because a green tick the
 * product worked out for itself means something different from one somebody
 * asserted.
 */
export type TaskState = "done" | "not_applicable" | "outstanding";

export interface JourneyTask {
  id: string;
  title: string;
  do: string;
  why: string;
  goto?: string;
  /** The clause of the standard this step satisfies, where there is one. */
  clause?: string;
  /** The file name of the policy template that gives this step a start, where there is one. */
  template?: string;
  /** Who is doing it, and where reminders go. Useless apart, by design. */
  owner: string;
  ownerEmail: string;
  dueDate: string | null;
  state: TaskState;
  automatic: boolean;
  detail: string;
  reason: string;
  updatedAt: string;
  actorName: string;
}

export interface JourneyStage {
  id: string;
  name: string;
  aim: string;
  tasks: JourneyTask[];
  applicable: number;
  done: number;
  pct: number;
  complete: boolean;
}

export interface Journey {
  title: string;
  intro: string;
  stages: JourneyStage[];
  applicable: number;
  done: number;
  pct: number;
  /** Where we suggest they go next. A suggestion: nothing is locked. */
  suggested: string | null;
}

export interface JourneyAssignment {
  owner?: string;
  ownerEmail?: string;
  dueDate?: string | null;
}

export const journey = {
  get: () => api.get<{ journey: Journey }>("/api/v1/journey").then((r) => r.journey),
  set: (taskId: string, state: TaskState, reason = "", assign: JourneyAssignment = {}) =>
    api
      .put<{ journey: Journey }>(`/api/v1/journey/${encodeURIComponent(taskId)}`, {
        state,
        reason,
        ...assign,
      })
      .then((r) => r.journey),
};

export interface PackSamples {
  note: string;
  assets: { id: string; name: string; items: Record<string, unknown>[] }[];
  risks: { id: string; name: string; items: Record<string, unknown>[] }[];
}

export interface PackGuide {
  /** What the control is for. */
  o?: string;
  /** What level 3 looks like in practice. Scored frameworks only. */
  l3?: string;
  /** What to do about it. */
  a?: string;
  /** What an assessor will look for. */
  e?: string;
  /** The records that prove it. */
  r?: string;
  /** The framework's own wording, where the pack carries it. */
  s?: string;
}

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "admin" | "contributor" | "auditor" | "readonly";
  /** Signed in with a temporary password; must choose a new one before anything else. */
  mustChangePassword?: boolean;
}

export const auth = {
  bootstrapNeeded: () => api.get<{ needsBootstrap: boolean }>("/api/v1/auth/bootstrap"),
  bootstrap: (b: { username: string; name: string; email: string; password: string }) =>
    api.post<{ user: SessionUser }>("/api/v1/auth/bootstrap", b),
  login: (username: string, password: string) =>
    api.post<{ user: SessionUser }>("/api/v1/auth/login", { username, password }),
  logout: () => api.post<{ ok: true }>("/api/v1/auth/logout"),
  me: () => api.get<{ user: SessionUser }>("/api/v1/auth/me"),
  /** Administrators only. The reply is the same whatever happened, by design. */
  forgot: (identifier: string) =>
    api.post<{ ok: true; message: string }>("/api/v1/auth/forgot", { identifier }),
  changePassword: (body: { currentPassword?: string; newPassword: string }) =>
    api.post<{ user: SessionUser }>("/api/v1/auth/password", body),
};

export const controls = {
  /** Which risks this control treats; replaces the whole set. */
  setRisks: (id: string, riskIds: string[]) =>
    api.put<{ risks: { id: string; seq: number; title: string }[] }>(`/api/v1/controls/${id}/risks`, { riskIds }),
  list: (filter: Partial<Record<"theme" | "status" | "owner" | "q", string>> = {}) => {
    const qs = new URLSearchParams(
      Object.entries(filter).filter(([, v]) => v) as [string, string][],
    ).toString();
    return api.get<{ controls: Control[] }>(`/api/v1/controls${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => api.get<{ control: Control }>(`/api/v1/controls/${id}`),
  update: (id: string, patch: ControlPatch) =>
    api.patch<{ control: Control }>(`/api/v1/controls/${id}`, toControlBody(patch)),
  summary: () =>
    api.get<{
      byStatus: Record<string, number>;
      byTheme: Record<string, Record<string, number>>;
      applicable: number;
      implemented: number;
      readinessPct: number;
      /** Only meaningful for packs that score maturity rather than status. */
      maturity: {
        /** In scope: everything the customer has not ruled out. */
        total: number;
        /** Ruled out, and therefore outside every figure here. */
        excluded: number;
        scored: number;
        unscored: number;
        atTarget: number;
        atTargetPct: number;
        average: number;
        defaultTarget: number;
        /** How many sit at each level, keyed by the level as a string. */
        byLevel: Record<string, number>;
        byTheme: Record<
          string,
          { inScope: number; scored: number; atTarget: number; average: number }
        >;
      };
    }>("/api/v1/controls/summary"),
};

/**
 * Rows come back with the database's column names, but writes take camelCase.
 * The mismatch is real and lives in the API, so it is absorbed here rather
 * than leaking into every form. See `toRiskBody` / `toEvidenceBody`.
 */
export const RISK_TREATMENTS = ["Mitigate", "Accept", "Transfer", "Avoid"] as const;
export const RISK_STATUSES = ["Open", "Treated", "Accepted", "Closed"] as const;
export type RiskBand = "critical" | "elevated" | "acceptable";

export interface Risk {
  id: string;
  seq: number;
  title: string;
  description: string;
  category: string;
  status: string;
  treatment: string;
  owner: string;
  likelihood: number;
  impact: number;
  res_likelihood: number | null;
  res_impact: number | null;
  review_date: string | null;
  accepted_by: string | null;
  accepted_date: string | null;
  inherent: number;
  residual: number;
  band: RiskBand;
  control_ids: string[];
  updated_at: string;
}

/** What a risk form submits. Matches the API's request body, not the row. */
export interface RiskInput {
  title: string;
  description?: string;
  category?: string;
  likelihood: number;
  impact: number;
  resLikelihood?: number | null;
  resImpact?: number | null;
  treatment?: string;
  status?: string;
  owner?: string;
  reviewDate?: string | null;
  acceptedBy?: string | null;
  controlIds?: string[];
}

/** Row -> form values, so editing starts from what is actually stored. */
export const riskToInput = (r: Risk): RiskInput => ({
  title: r.title,
  description: r.description,
  category: r.category,
  likelihood: r.likelihood,
  impact: r.impact,
  resLikelihood: r.res_likelihood,
  resImpact: r.res_impact,
  treatment: r.treatment,
  status: r.status,
  owner: r.owner,
  reviewDate: r.review_date,
  acceptedBy: r.accepted_by,
  controlIds: r.control_ids,
});

export const risks = {
  list: () => api.get<{ risks: Risk[] }>("/api/v1/risks"),
  create: (body: RiskInput) => api.post<{ risk: Risk }>("/api/v1/risks", body),
  update: (id: string, body: Partial<RiskInput>) =>
    api.patch<{ risk: Risk }>(`/api/v1/risks/${id}`, body),
  remove: (id: string) => api.delete<void>(`/api/v1/risks/${id}`),
  summary: () =>
    api.get<{
      byBand: Record<string, number>;
      byStatus: Record<string, number>;
      heatmap: Record<string, number>;
      total: number;
    }>("/api/v1/risks/summary"),
};

export type Freshness = "fresh" | "ageing" | "due" | "stale" | "unknown";

export interface Evidence {
  id: string;
  name: string;
  type: string;
  owner: string;
  /** Where the reminder goes when the review date arrives. */
  owner_email: string | null;
  collected_date: string | null;
  next_review: string | null;
  notes: string;
  freshness: Freshness;
  age_days: number | null;
  /** The attached document, when there is one. */
  file_name: string | null;
  file_size: number | null;
  file_sha256: string | null;
  control_ids: string[];
  updated_at: string;
}

export interface EvidenceInput {
  name: string;
  type?: string;
  owner?: string;
  /** Where the reminder goes when the review date arrives. */
  ownerEmail?: string;
  collectedDate?: string | null;
  nextReview?: string | null;
  notes?: string;
  controlIds?: string[];
}

export const evidenceToInput = (e: Evidence): EvidenceInput => ({
  name: e.name,
  type: e.type,
  owner: e.owner,
  ownerEmail: e.owner_email ?? "",
  collectedDate: e.collected_date,
  nextReview: e.next_review,
  notes: e.notes,
  controlIds: e.control_ids,
});

export const evidence = {
  list: () => api.get<{ evidence: Evidence[] }>("/api/v1/evidence"),
  create: (body: EvidenceInput) => api.post<{ evidence: Evidence }>("/api/v1/evidence", body),
  update: (id: string, body: Partial<EvidenceInput>) =>
    api.patch<{ evidence: Evidence }>(`/api/v1/evidence/${id}`, body),
  remove: (id: string) => api.delete<void>(`/api/v1/evidence/${id}`),

  /**
   * Attaches a document.
   *
   * Sent as multipart rather than JSON so the browser streams it instead of
   * holding a base64 copy in memory, which for a 25 MB file matters.
   */
  attach: (id: string, file: File) => {
    const body = new FormData();
    body.append("file", file, file.name);
    return api.upload<{ evidence: Evidence }>(`/api/v1/evidence/${id}/file`, body);
  },
  detach: (id: string) => api.delete<void>(`/api/v1/evidence/${id}/file`),
  fileUrl: (id: string) => `/api/v1/evidence/${id}/file`,
  summary: () =>
    api.get<{
      byFreshness: Record<string, number>;
      total: number;
      controlsImplementedWithoutEvidence: number;
    }>("/api/v1/evidence/summary"),
};

/**
 * The framework pack is copied next to the bundle at build time, so the labels
 * ("Function" vs "Theme", "Subcategory" vs "Control") come from the same file
 * the API seeded its controls from.
 */
export interface Pack {
  id: string;
  product: string;
  framework: string;
  frameworkShort: string;
  themeLabel: string;
  itemLabel: string;
  /** Empty unless there is ever more than one edition to tell apart. */
  edition: string;
  disclaimer: string;
  /** Support address, shown under the disclaimer. */
  contact: string;
  /**
   * Which product-specific screens and fields this pack turns on — `tiers`,
   * `profiles`, `priorities`, `baselines`, `parameters`, `origination`,
   * `statementOfApplicability`. One codebase, three products, decided here.
   */
  features?: Record<string, boolean>;
}

export interface Programme {
  scope: string;
  methodology: string;
  attrs: Record<string, unknown>;
  updated_at: string;
}

export const programme = {
  get: () => api.get<{ programme: Programme }>("/api/v1/programme").then((r) => r.programme),
  update: (body: Partial<Pick<Programme, "scope" | "methodology" | "attrs">>) =>
    api.patch<{ programme: Programme }>("/api/v1/programme", body).then((r) => r.programme),
  applyBaseline: (level: "low" | "moderate" | "high") =>
    api.post<{ level: string; selected: number; excluded: number; restored: number; total: number }>(
      "/api/v1/controls/baseline",
      { level },
    ),
};

/** One organisation-defined parameter on an 800-53 control. */
export interface PackParam {
  id: string;
  label: string;
  hint: string;
  sel: { howMany: string; choices: string[] } | null;
}

export const pack = {
  meta: () => api.get<Pack>("/pack/pack.json"),
  themes: () => api.get<Record<string, string>>("/pack/themes.json"),
  /** Only Anchor ships this; the caller checks the feature flag first. */
  parameters: () => api.get<Record<string, PackParam[]>>("/pack/parameters.json"),
  /** Written guidance per control. Every pack ships it; the shape varies. */
  guide: () => api.get<Record<string, PackGuide>>("/pack/guide.json"),
  /** Starting points for an empty asset or risk register. */
  samples: () => api.get<PackSamples>("/pack/samples.json"),
};

/**
 * The Phase 3 registers share one implementation on the server, so they share
 * one client here. `list` unwraps `{ assets: [...] }`, the single-item calls
 * unwrap `{ asset: {...} }`.
 */
export interface RegisterRow {
  id: string;
  seq: number;
  updated_at: string;
  [key: string]: unknown;
}

export interface RegisterApi<T extends RegisterRow = RegisterRow> {
  list: () => Promise<T[]>;
  create: (body: Record<string, unknown>) => Promise<T>;
  update: (id: string, body: Record<string, unknown>) => Promise<T>;
  remove: (id: string) => Promise<void>;
}

export function registerApi<T extends RegisterRow = RegisterRow>(
  path: string,
  singular: string,
): RegisterApi<T> {
  const base = `/api/v1/${path}`;
  return {
    list: () => api.get<Record<string, T[]>>(base).then((r) => r[path] ?? []),
    create: (body) => api.post<Record<string, T>>(base, body).then((r) => r[singular]!),
    update: (id, body) =>
      api.patch<Record<string, T>>(`${base}/${id}`, body).then((r) => r[singular]!),
    remove: (id) => api.delete<void>(`${base}/${id}`),
  };
}

export const assets = registerApi("assets", "asset");

/** A file attached to a register record. */
export interface Attachment {
  id: string;
  name: string;
  size: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
}

/** Files on register records: contracts, minutes, exports, certificates. */
export const attachments = {
  list: (register: string, id: string) =>
    api.get<{ attachments: Attachment[] }>(`/api/v1/attachments/${register}/${id}`).then((r) => r.attachments),
  add: (register: string, id: string, file: File) => {
    const body = new FormData();
    body.append("file", file, file.name);
    return api.upload<{ attachment: Attachment }>(`/api/v1/attachments/${register}/${id}`, body)
      .then((r) => r.attachment);
  },
  remove: (attachmentId: string) => api.delete<void>(`/api/v1/attachments/file/${attachmentId}`),
  fileUrl: (attachmentId: string) => `/api/v1/attachments/file/${attachmentId}`,
};
export const policies = registerApi("policies", "policy");

/** One person, one version, one date: the proof a policy was read. */
export interface PolicyAcknowledgement {
  id: string;
  person: string;
  version: string;
  acknowledged_on: string;
  note: string;
}

/**
 * Acknowledgements hang off a policy rather than sitting in its body, so they
 * are written the moment they are recorded and not when the policy is saved.
 */
export const policyAcknowledgements = {
  add: (policyId: string, body: { person: string; version?: string; acknowledgedOn?: string }) =>
    api
      .post<{ acknowledgement: PolicyAcknowledgement }>(
        `/api/v1/policies/${policyId}/acknowledgements`,
        body,
      )
      .then((r) => r.acknowledgement),
  remove: (policyId: string, id: string) =>
    api.delete<void>(`/api/v1/policies/${policyId}/acknowledgements/${id}`),
};
export const tasks = registerApi("tasks", "task");
export const incidents = registerApi("incidents", "incident");
export const findings = registerApi("findings", "finding");

export interface ReportInfo {
  id: string;
  title: string;
  description: string;
}

export const reports = {
  list: () => api.get<{ reports: ReportInfo[] }>("/api/v1/reports").then((r) => r.reports),

  /**
   * Fetched rather than linked. A plain link cannot report a failure — an
   * expired session would navigate the browser to a JSON error page — and
   * cannot tell the button when the file has arrived.
   */
  async download(id: string): Promise<{ blob: Blob; filename: string }> {
    const response = await fetch(`/api/v1/reports/${id}`, {
      headers: { accept: "application/pdf" },
      credentials: "same-origin",
    });
    if (!response.ok) {
      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent("offset:signed-out"));
      }
      const detail = await response.json().catch(() => ({}));
      if (response.status === 404 && detail.error === "No such endpoint.") {
        throw new Error(
          "This screen needs a newer version of the server than the one running. " +
            "Restart the application and reload this page.",
        );
      }
      throw new Error(detail.error ?? `Could not build the report (${response.status}).`);
    }
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    return { blob: await response.blob(), filename: match?.[1] ?? `${id}.pdf` };
  },
};

export interface BrandLogo {
  kind: "image" | "svg";
  data: string;
  filename: string;
  bytes: number;
}

export const branding = {
  get: () =>
    api.get<{ branding: { logo: BrandLogo | null } }>("/api/v1/settings/branding")
      .then((r) => r.branding.logo),
  set: (logo: { kind: "image" | "svg"; data: string; filename: string } | null) =>
    api.put<{ branding: { logo: BrandLogo | null } }>("/api/v1/settings/branding", { logo })
      .then((r) => r.branding.logo),
};

/**
 * Outgoing email settings.
 *
 * The password is never part of this: the server does not return it, and the
 * form sends one only when it is being set or cleared.
 */
/**
 * Mail routes the form knows how to fill in by itself.
 *
 * Mirrors MAIL_PROVIDERS on the server. The labels live here because they are
 * screen text; the host and port live there because they are the truth.
 */
export const MAIL_PROVIDERS = {
  custom: {
    label: "Any SMTP server",
    secretLabel: "Password",
    /** The same thing, worded to sit inside a sentence. */
    inlineLabel: "password",
    note: "",
  },
  resend: {
    label: "Resend",
    secretLabel: "Resend API key",
    inlineLabel: "Resend API key",
    note: "Sends through smtp.resend.com on port 465. Nothing else to fill in.",
  },
} as const;

export type MailProvider = keyof typeof MAIL_PROVIDERS;

export interface SmtpSettings {
  provider: MailProvider;
  enabled: boolean;
  host: string;
  port: number;
  /** True for implicit TLS (port 465). False means STARTTLS. */
  secure: boolean;
  username: string;
  fromAddress: string;
  fromName: string;
  rejectUnauthorized: boolean;
  /** Read-only: whether one is stored, never what it is. */
  hasPassword: boolean;
}

export interface SmtpTestResult {
  ok: boolean;
  to?: string;
  /** 'connect' or 'send' — which half failed. */
  stage?: string;
  reason?: string;
}

export const smtp = {
  get: () => api.get<{ smtp: SmtpSettings }>("/api/v1/settings/smtp").then((r) => r.smtp),
  save: (body: Omit<SmtpSettings, "hasPassword"> & { password?: string }) =>
    api.put<{ smtp: SmtpSettings }>("/api/v1/settings/smtp", body).then((r) => r.smtp),
  test: (to: string) => api.post<SmtpTestResult>("/api/v1/settings/smtp/test", { to }),
};

/** Who is told when something is overdue. */
export interface ChainLevel {
  role: string;
  name: string;
  email: string;
  days: number;
}

export interface EscalationState {
  escalation: { enabled: boolean; chain: ChainLevel[] };
  schedule: { before: number[]; repeatDays: number };
  emailReady: boolean;
  emailProblem: string | null;
}

export interface ReminderLogRow {
  id: string;
  sent_on: string;
  kind: string;
  stage: string;
  level: number;
  to_email: string;
  cc: string;
  subject: string;
  item_ref: string;
  item_title: string;
  owner: string;
  due_date: string;
  ok: number;
  error: string | null;
}

export interface ReminderRun {
  blocked?: string;
  owner: number;
  chain: number;
  failed: number;
  reasons: string[];
}

export const escalation = {
  get: () => api.get<EscalationState>("/api/v1/escalation"),
  save: (body: { enabled: boolean; chain: { name: string; email: string; days: number }[] }) =>
    api.put<{ escalation: { enabled: boolean; chain: ChainLevel[] } }>("/api/v1/escalation", body)
      .then((r) => r.escalation),
  log: (limit = 100) =>
    api.get<{ log: ReminderLogRow[] }>(`/api/v1/escalation/log?limit=${limit}`).then((r) => r.log),
  run: () => api.post<{ result: ReminderRun }>("/api/v1/escalation/run").then((r) => r.result),
};

/** The daily digest. */
export interface DigestSettings {
  enabled: boolean;
  /** Empty means every enabled administrator with an email address. */
  recipients: string[];
  sendWhenEmpty: boolean;
  horizonDays: number;
}

export interface DigestPreview {
  subject: string;
  body: string;
  actionable: number;
  recipients: string[];
  wouldSend: boolean;
}

export const digest = {
  get: () => api.get<{ digest: DigestSettings }>("/api/v1/settings/digest").then((r) => r.digest),
  save: (body: DigestSettings) =>
    api.put<{ digest: DigestSettings }>("/api/v1/settings/digest", body).then((r) => r.digest),
  preview: () => api.get<DigestPreview>("/api/v1/settings/digest/preview"),
  send: () =>
    api.post<{ ok: boolean; to?: string[]; actionable?: number; reason?: string }>(
      "/api/v1/settings/digest/send",
    ),
};

export const USER_ROLES = ["admin", "contributor", "auditor", "readonly"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface ManagedUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: UserRole;
  auth_source: string;
  disabled: number;
  last_login_at: string | null;
  locked_until: string | null;
  failed_logins: number;
  created_at: string;
  /** 1 while an invitation has been sent that can still be used. */
  invited?: number;
}

export interface NewUser {
  username: string;
  name: string;
  email: string;
  role: UserRole;
  /** Left out when inviting: the person chooses their own. */
  password?: string;
  invite?: boolean;
}

export const users = {
  list: () => api.get<{ users: ManagedUser[] }>("/api/v1/users").then((r) => r.users),
  create: (body: NewUser) => api.post<{ user: ManagedUser }>("/api/v1/users", body).then((r) => r.user),
  update: (id: string, body: Partial<Pick<ManagedUser, "name" | "email" | "role">> & { disabled?: boolean }) =>
    api.patch<{ user: ManagedUser }>(`/api/v1/users/${id}`, body).then((r) => r.user),
  invite: (id: string) =>
    api.post<{ user: ManagedUser }>(`/api/v1/users/${id}/invite`).then((r) => r.user),
  setPassword: (id: string, password: string) =>
    api.post<{ user: ManagedUser }>(`/api/v1/users/${id}/password`, { password }).then((r) => r.user),
  unlock: (id: string) =>
    api.post<{ user: ManagedUser }>(`/api/v1/users/${id}/unlock`).then((r) => r.user),
};

export const health = () =>
  api.get<{ status: string; product: string; name: string; framework: string; version: string }>(
    "/api/v1/health",
  );

// ── updates ──────────────────────────────────────────────────────────────────

export type InstallKind = "docker" | "linux" | "windows" | "none";

export type UpdateState =
  | "queued" | "downloading" | "installing" | "verifying" | "done" | "failed" | "rolled_back";

export interface UpdateCheck {
  checkedAt: string;
  current: string;
  latest: string | null;
  published: string | null;
  notes: string;
  newer: boolean;
  installable: boolean;
  error: string | null;
}

export interface UpdateStatus {
  requestId: string;
  version: string;
  from: string;
  state: UpdateState;
  message: string;
  updatedAt: string;
}

export interface UpdatesOverview {
  current: string;
  product: string;
  installKind: InstallKind;
  updater: { present: boolean; seenAt: string | null };
  lastCheck: UpdateCheck | null;
  status: UpdateStatus | null;
  customKeys: boolean;
}

export const updates = {
  get: () => api.get<UpdatesOverview>("/api/v1/updates"),
  check: () => api.post<{ lastCheck: UpdateCheck }>("/api/v1/updates/check").then((r) => r.lastCheck),
  apply: (version: string) =>
    api.post<{ request: { id: string; version: string } }>("/api/v1/updates/apply", { version }),
};

// ── the management-system registers ──────────────────────────────────────────

export const vendors = registerApi("vendors", "vendor");
export const training = registerApi("training", "training");
export const objectives = registerApi("objectives", "objective");
export const parties = registerApi("parties", "party");
export const reviews = registerApi("reviews", "review");
export const communications = registerApi("communications", "communication");

// ── everything with a date on it ─────────────────────────────────────────────

export interface CalendarItem {
  kind: string;
  screen: string;
  id: string;
  title: string;
  detail: string;
  owner: string;
  due: string;
}

export interface Calendar {
  today: string;
  horizon: string;
  items: CalendarItem[];
  counts: { overdue: number; soon: number; later: number };
}

export const calendar = {
  read: (days = 90) => api.get<Calendar>(`/api/v1/calendar?days=${days}`),
};

// ── control testing ──────────────────────────────────────────────────────────

export interface ControlTest {
  id: string;
  control_id: string;
  tested_on: string;
  tester: string;
  result: "Pass" | "Fail" | "Partial";
  note: string;
  created_at: string;
}

export const controlTests = {
  list: (controlId: string) =>
    api.get<{ tests: ControlTest[] }>(`/api/v1/controls/${controlId}/tests`).then((r) => r.tests),
  add: (controlId: string, body: { testedOn: string; tester: string; result: string; note: string }) =>
    api.post<{ test: ControlTest }>(`/api/v1/controls/${controlId}/tests`, body).then((r) => r.test),
  remove: (controlId: string, testId: string) =>
    api.delete<void>(`/api/v1/controls/${controlId}/tests/${testId}`),
};

// ── example data ─────────────────────────────────────────────────────────────

export const demo = {
  state: () => api.get<{ rows: number; available: number }>("/api/v1/demo"),
  load: () => api.post<{ rows: number }>("/api/v1/demo"),
  remove: () => api.delete<{ removed: number }>("/api/v1/demo"),
};

// ── help and the guides, also from the pack ──────────────────────────────────

export interface HelpPage {
  file: string;
  title: string;
  about: string;
  /** The section of the list this page sits under, when the list has sections. */
  group?: string;
}

export const help = {
  index: () =>
    api.get<{ note: string; help: HelpPage[]; guides: HelpPage[] }>("/pack/help/index.json"),
  /** Markdown, rendered in the browser. Not JSON, so it is fetched directly. */
  page: async (file: string): Promise<string> => {
    const res = await fetch(`/pack/help/${encodeURIComponent(file)}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`That page could not be loaded (${res.status}).`);
    return res.text();
  },
};

// ── document templates that ship with the pack ───────────────────────────────

export interface PackTemplate {
  file: string;
  title: string;
  about: string;
}

export const templates = {
  index: () => api.get<{ note: string; documents: PackTemplate[] }>("/pack/templates/index.json"),
  url: (file: string) => `/pack/templates/${encodeURIComponent(file)}`,
  /** The same file with this organisation's answers and records put in. */
  filledUrl: (file: string) => `/api/v1/templates/filled/${encodeURIComponent(file)}`,
  allFilledUrl: "/api/v1/templates/filled.zip",
  fill: () => api.get<TemplateFill>("/api/v1/templates").catch(() => null),
  saveAnswers: (answers: TemplateAnswers) =>
    api.put<{ answers: TemplateAnswers; status: TemplateStatus[] }>("/api/v1/templates/answers", answers),
};

/** One piece of a table cell in a template: words, or a blank the form asks for. */
export interface TemplatePart {
  text?: string;
  name?: string;
  shared?: boolean;
  computed?: string;
  hint?: string;
  suggest?: string;
}

export interface TemplateItem {
  t: "field" | "grid" | "list" | "source";
  section: string;
  name?: string;
  id?: string;
  source?: string;
  header?: string[];
  rows?: TemplatePart[][][];
}

export interface TemplateDocField {
  label: string;
  hint: string;
  default: string;
  long: boolean;
  context: string;
}

export interface TemplateSharedField {
  name: string;
  group: string;
  label: string;
  hint?: string;
  default?: string;
  long?: boolean;
}

export interface TemplateDoc {
  file: string;
  no: string;
  title: string;
  id: string;
  items: TemplateItem[];
  fields: Record<string, TemplateDocField>;
  shared: string[];
}

export interface TemplateAnswers {
  values: Record<string, string>;
  lists: Record<string, string[][]>;
}

export interface TemplateStatus {
  file: string;
  left: number;
  total: number;
}

export interface TemplateFill {
  manifest: {
    groups: { id: string; title: string; note: string }[];
    shared: TemplateSharedField[];
    library: Record<string, { label: string; row: string[] }[]>;
    listHelp: Record<string, string>;
    documents: TemplateDoc[];
  };
  answers: TemplateAnswers;
  /** What the product already knows, by blank name (for example the scope). */
  known: Record<string, string>;
  /** How many records each register has, by the name tables use for it. */
  counts: Record<string, number>;
  status: TemplateStatus[];
}

// ── backups ──────────────────────────────────────────────────────────────────

export interface BackupInfo {
  name: string;
  kind: "nightly" | "manual" | "pre-restore" | "pre-update" | "uploaded";
  size: number;
  createdAt: string;
  includesEvidence: boolean;
  evidenceFiles: number;
  version: string | null;
}

export const backups = {
  list: () => api.get<{ backups: BackupInfo[] }>("/api/v1/backups").then((r) => r.backups),
  take: () => api.post<{ backup: BackupInfo }>("/api/v1/backups").then((r) => r.backup),
  upload: (file: File) => {
    const body = new FormData();
    body.append("file", file, file.name);
    return api.upload<{ backup: BackupInfo }>("/api/v1/backups/upload", body).then((r) => r.backup);
  },
  restore: (name: string) =>
    api.post<{ signedOut: true }>(`/api/v1/backups/${encodeURIComponent(name)}/restore`, { confirm: "RESTORE" }),
  remove: (name: string) => api.delete<void>(`/api/v1/backups/${encodeURIComponent(name)}`),
  downloadUrl: (name: string) => `/api/v1/backups/${encodeURIComponent(name)}/download`,
};

// ── audit trail ──────────────────────────────────────────────────────────────

export interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AuditEntry {
  id: number;
  ts: string;
  person: string;
  ip: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  label: string | null;
  changes: AuditChange[];
  before: unknown;
  after: unknown;
}

/** From and to are instants: the start of the first day and of the day after the last. */
export interface AuditFilters {
  q?: string;
  person?: string;
  action?: string;
  from?: string;
  to?: string;
}

export interface AuditChoices {
  people: string[];
  actions: string[];
  entities: string[];
  oldest: string | null;
  retentionDays: number;
}

const auditQuery = (f: AuditFilters, extra: Record<string, string> = {}): string => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) params.set(k, v);
  const s = params.toString();
  return s ? `?${s}` : "";
};

export const auditTrail = {
  list: (f: AuditFilters, before?: number) =>
    api.get<{ entries: AuditEntry[]; next: number | null; total?: number }>(
      `/api/v1/audit${auditQuery(f, before ? { before: String(before) } : {})}`,
    ),
  choices: () => api.get<AuditChoices>("/api/v1/audit/filters"),
  exportUrl: (f: AuditFilters) => `/api/v1/audit/export${auditQuery(f)}`,
};

/** Settings → HTTPS certificate. Administrators only. */
export interface CertificateInfo {
  subject: string;
  names: string[];
  issuer: string;
  selfSigned: boolean;
  validFrom: string;
  validTo: string;
  daysLeft: number;
  fingerprint: string;
}

export interface CertificateStatus {
  serving: "http" | "https";
  source: "uploaded" | "settings" | "none";
  certificate: CertificateInfo | null;
  problem: string | null;
  warnings: string[];
  upload: { uploadedAt: string; filenames: string[] } | null;
  restartNeeded: boolean;
  installKind: "docker" | "linux" | "windows" | "none";
  localOnly: boolean;
  restartHow: string;
  publicUrl: string;
  removeBlocked: string | null;
}

export type CertificateUpload =
  | { needsConfirmation: true; certificate: CertificateInfo; warnings: string[] }
  | { needsConfirmation: false; appliedNow: boolean; status: CertificateStatus };

export const certificate = {
  get: () => api.get<CertificateStatus>("/api/v1/settings/certificate"),
  upload: (files: { name: string; data: string }[], password: string, confirm: boolean) =>
    api.put<CertificateUpload>("/api/v1/settings/certificate", { files, password, confirm }),
  remove: () => api.delete<{ appliedNow: boolean; status: CertificateStatus }>("/api/v1/settings/certificate"),
};

/** The golden thread: risks, the controls that treat them, and the proof. */
export interface ThreadRisk {
  id: string;
  seq: number;
  title: string;
  treatment: string;
  status: string;
  owner: string;
  /** Control ids. */
  controls: string[];
}
export interface ThreadControl {
  id: string;
  ref: string;
  title: string;
  theme: string;
  status: ControlStatus;
  owner: string;
  /** The Statement of Applicability gives a reason for this control. */
  justified: boolean;
}
export interface ThreadEvidence {
  id: string;
  name: string;
  collectedDate: string | null;
  /** Days since it was collected. Null when it has no date. */
  ageDays: number | null;
  /** Control ids. */
  controls: string[];
}
export interface ThreadData {
  staleDays: number;
  risks: ThreadRisk[];
  controls: ThreadControl[];
  evidence: ThreadEvidence[];
}
export const thread = {
  get: () => api.get<ThreadData>("/api/v1/thread"),
  /** One control's part of the thread, for its "How to fix this" list. */
  control: (id: string) => api.get<ControlThread>(`/api/v1/thread/control/${id}`),
};

export interface ControlThread {
  staleDays: number;
  risks: { id: string; seq: number; title: string }[];
  evidence: { name: string; ageDays: number | null }[];
  tests: { count: number; last: string | null };
}
