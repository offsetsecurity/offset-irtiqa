import { useEffect, useMemo, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { Modal, Field } from "./Modal.js";
import {
  users, smtp, USER_ROLES, type ManagedUser, type UserRole, type SessionUser,
} from "../persistence/apiClient.js";
import { since } from "./format.js";

/**
 * User administration.
 *
 * Accounts are disabled, never deleted: the audit log points at them, and
 * "who approved this" must keep its answer. The server refuses anything that
 * would leave the instance without an administrator; this screen just explains
 * why before you try.
 */

const ROLE_BLURB: Record<UserRole, string> = {
  admin: "Everything, including users, backups and settings.",
  contributor: "Read and change all GRC data. Cannot manage users.",
  auditor: "Read everything, including the audit log. Cannot change anything.",
  readonly: "Read everything. Cannot change anything.",
};

const ROLE_TONE: Record<UserRole, string> = {
  admin: "#b91c1c",
  contributor: "#2457D6",
  auditor: "#7c3aed",
  readonly: "#475569",
};

/** A password someone can read out over the phone without ambiguity. */
function suggestPassword(): string {
  const words = [
    "harbour", "lantern", "pebble", "thistle", "marigold", "compass", "juniper",
    "quarry", "saffron", "willow", "cobalt", "ember", "granite", "meadow",
  ];
  const pick = (): string => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return words[buf[0]! % words.length]!;
  };
  const digits = new Uint32Array(1);
  crypto.getRandomValues(digits);
  return `${pick()}-${pick()}-${pick()}-${digits[0]! % 90 + 10}`;
}

export function Users({ me }: { me: SessionUser }): VNode {
  const [rows, setRows] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const [adding, setAdding] = useState<Record<string, unknown> | null>(null);
  /**
   * Merges against the current draft rather than one captured when the handler
   * was created. Setting several fields before a re-render — autofill does
   * exactly that — would otherwise keep only the last one.
   */
  const patchAdd = (patch: Record<string, unknown>): void =>
    setAdding((d) => (d ? { ...d, ...patch } : d));
  const patchEdit = (patch: Partial<ManagedUser>): void =>
    setEditing((d) => (d ? { ...d, ...patch } : d));
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [resetting, setResetting] = useState<ManagedUser | null>(null);
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);
  /** What happened to the last invitation, in words, until somebody dismisses it. */
  const [notice, setNotice] = useState("");
  /** Whether email is set up. Inviting needs it; until it is known, assume not. */
  const [mailOn, setMailOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let live = true;
    users
      .list()
      .then((r) => live && setRows(r))
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    smtp
      .get()
      .then((s) => live && setMailOn(Boolean(s.enabled)))
      .catch(() => live && setMailOn(false));
    return () => { live = false; };
  }, []);

  const reload = async (): Promise<void> => setRows(await users.list());

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (u) =>
        !needle ||
        u.username.toLowerCase().includes(needle) ||
        u.name.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const activeAdmins = (rows ?? []).filter((u) => u.role === "admin" && !u.disabled).length;
  const isLocked = (u: ManagedUser): boolean =>
    Boolean(u.locked_until && new Date(u.locked_until) > new Date());

  async function run(action: () => Promise<unknown>, close?: () => void): Promise<void> {
    setBusy(true);
    setFormError("");
    try {
      await action();
      await reload();
      close?.();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return html`<div class="card pad err">${error}</div>`;
  if (!rows) return html`<div class="card pad muted">Loading…</div>`;

  return html`<>
    <div class="card pad">
      <div class="toolbar">
        <input type="search" placeholder="Search people…" value=${q}
               onInput=${(e: Event) => setQ((e.target as HTMLInputElement).value)} />
        <div class="toolbar-note muted">
          ${shown.length} of ${rows.length} · ${activeAdmins} administrator${activeAdmins === 1 ? "" : "s"}
        </div>
        <button class="btn primary" onClick=${() => {
          setFormError("");
          setNotice("");
          setAdding({
            username: "", name: "", email: "", role: "contributor",
            password: suggestPassword(), invite: mailOn,
          });
        }}>Add person</button>
      </div>

      ${notice ? html`<div class="ok-note" role="status">${notice}</div>` : null}

      <table>
        <thead>
          <tr>
            <th>Person</th>
            <th style="width:130px">Role</th>
            <th style="width:120px">Status</th>
            <th style="width:120px">Last signed in</th>
            <th style="width:190px"></th>
          </tr>
        </thead>
        <tbody>
          ${shown.map((u) => html`
            <tr key=${u.id} class=${u.disabled ? "saving" : ""}>
              <td>
                <div>
                  ${u.name}
                  ${u.id === me.id ? html`<span class="muted" style="font-size:11.5px"> — you</span>` : null}
                </div>
                <div class="muted" style="font-size:11.5px">${u.username} · ${u.email}</div>
              </td>
              <td>
                <span class="pill" style=${`background:${ROLE_TONE[u.role]}1a;color:${ROLE_TONE[u.role]}`}>
                  ${u.role}
                </span>
              </td>
              <td>
                ${u.disabled
                  ? html`<span class="pill slate">Disabled</span>`
                  : isLocked(u)
                  ? html`<span class="pill amber">Locked out</span>`
                  : u.invited && !u.last_login_at
                  ? html`<span class="pill amber">Invited</span>`
                  : html`<span class="pill green">Active</span>`}
              </td>
              <td class="muted">${u.last_login_at ? since(u.last_login_at) : "never"}</td>
              <td>
                <div class="row-actions">
                  <button class="linkish" onClick=${() => { setFormError(""); setEditing(u); }}>Edit</button>
                  ${isLocked(u)
                    ? html`<button class="linkish" disabled=${busy}
                              onClick=${() => void run(() => users.unlock(u.id))}>Unlock</button>`
                    : null}
                  ${mailOn && !u.disabled && !u.last_login_at && u.auth_source === "local"
                    ? html`<button class="linkish" disabled=${busy}
                              title="They have not signed in yet. This sends a fresh one-time sign-in and cancels the earlier one."
                              onClick=${() => void run(async () => {
                                await users.invite(u.id);
                                setNotice(`A new one-time sign-in was emailed to ${u.email}.`);
                              })}>Send invitation again</button>`
                    : null}
                  <button class="linkish" onClick=${() => {
                    setFormError("");
                    setIssued(null);
                    setResetting(u);
                  }}>Reset password</button>
                </div>
              </td>
            </tr>`)}
        </tbody>
      </table>

      ${shown.length === 0
        ? html`<p class="muted" style="padding:16px 4px">Nobody matches that search.</p>`
        : null}
    </div>

    ${adding
      ? html`<${Modal}
          title="Add person"
          submitLabel="Add person"
          busy=${busy}
          error=${formError}
          onClose=${() => setAdding(null)}
          onSubmit=${(e: Event) => {
            e.preventDefault();
            const draft = adding as Record<string, string>;
            const inviting = Boolean(adding["invite"]);
            void run(
              async () => {
                if (inviting) {
                  await users.create({
                    username: draft["username"]!, name: draft["name"]!, email: draft["email"]!,
                    role: draft["role"] as UserRole, invite: true,
                  });
                  setNotice(
                    `${draft["name"]} was emailed a one-time sign-in at ${draft["email"]}. ` +
                      "It works once, for 3 days, and they choose their own password. " +
                      "You never see it.",
                  );
                  return;
                }
                await users.create({
                  username: draft["username"]!, name: draft["name"]!, email: draft["email"]!,
                  role: draft["role"] as UserRole, password: draft["password"]!,
                });
                setIssued({ name: draft["name"]!, password: draft["password"]! });
              },
              () => setAdding(null),
            );
          }}
        >
          <div class="form-grid">
            <${Field} label="Full name" wide=${true}>
              <input required value=${String(adding["name"] ?? "")}
                     onInput=${(e: Event) =>
                       patchAdd({ name: (e.target as HTMLInputElement).value })} />
            <//>
            <${Field} label="Username" hint="Letters, numbers, dot, dash and underscore.">
              <input required value=${String(adding["username"] ?? "")}
                     onInput=${(e: Event) =>
                       patchAdd({ username: (e.target as HTMLInputElement).value })} />
            <//>
            <${Field} label="Email">
              <input type="email" required value=${String(adding["email"] ?? "")}
                     onInput=${(e: Event) =>
                       patchAdd({ email: (e.target as HTMLInputElement).value })} />
            <//>
            <${Field} label="Role" wide=${true} hint=${ROLE_BLURB[adding["role"] as UserRole]}>
              <select value=${String(adding["role"])}
                      onChange=${(e: Event) =>
                        patchAdd({ role: (e.target as HTMLSelectElement).value })}>
                ${USER_ROLES.map((r) => html`<option value=${r}>${r}</option>`)}
              </select>
            <//>
            ${mailOn
              ? html`<label class="fld wide check">
                  <input type="checkbox" checked=${Boolean(adding["invite"])}
                         onChange=${(e: Event) =>
                           patchAdd({ invite: (e.target as HTMLInputElement).checked })} />
                  <span>
                    Email them an invitation, so they choose their own password
                    <em class="hint">
                      They get a one-time sign-in that works once, for 3 days. You never see
                      or choose their password.
                    </em>
                  </span>
                </label>`
              : null}
            ${adding["invite"]
              ? null
              : html`<${Field} label="First password" wide=${true}
                        hint=${mailOn
                          ? "At least 12 characters. Give it to them directly. The email they receive does not contain the password."
                          : "At least 12 characters. Give it to them directly. Email is not set up, so nobody can be invited yet."}>
                  <div class="pw-row">
                    <input required minLength=${12} value=${String(adding["password"] ?? "")}
                           onInput=${(e: Event) =>
                             patchAdd({ password: (e.target as HTMLInputElement).value })} />
                    <button type="button" class="btn"
                            onClick=${() => patchAdd({ password: suggestPassword() })}>
                      Suggest
                    </button>
                  </div>
                <//>`}
          </div>
        <//>`
      : null}

    ${editing
      ? html`<${Modal}
          title=${editing.name}
          submitLabel="Save changes"
          busy=${busy}
          error=${formError}
          onClose=${() => setEditing(null)}
          onSubmit=${(e: Event) => {
            e.preventDefault();
            void run(
              () => users.update(editing.id, {
                name: editing.name, email: editing.email, role: editing.role,
              }),
              () => setEditing(null),
            );
          }}
        >
          <div class="form-grid">
            <${Field} label="Full name" wide=${true}>
              <input required value=${editing.name}
                     onInput=${(e: Event) =>
                       patchEdit({ name: (e.target as HTMLInputElement).value })} />
            <//>
            <${Field} label="Username">
              <input value=${editing.username} disabled=${true} />
            <//>
            <${Field} label="Email">
              <input type="email" required value=${editing.email}
                     onInput=${(e: Event) =>
                       patchEdit({ email: (e.target as HTMLInputElement).value })} />
            <//>
            <${Field} label="Role" wide=${true} hint=${ROLE_BLURB[editing.role]}>
              <select value=${editing.role} disabled=${editing.id === me.id}
                      onChange=${(e: Event) =>
                        patchEdit({ role: (e.target as HTMLSelectElement).value as UserRole })}>
                ${USER_ROLES.map((r) => html`<option value=${r}>${r}</option>`)}
              </select>
            <//>

            <div class="preview wide">
              ${editing.id === me.id
                ? "This is your own account. You cannot change your own role or disable yourself — that is what would lock you out."
                : editing.disabled
                ? "This account is disabled. They cannot sign in, and their history is kept."
                : activeAdmins === 1 && editing.role === "admin"
                ? "This is the only administrator. Give someone else the role before changing this one."
                : "Disabling signs them out immediately. Nothing is deleted; the audit log keeps their history."}
            </div>

            ${editing.id === me.id
              ? null
              : html`<div class="wide">
                  <button type="button" class=${`btn ${editing.disabled ? "" : "danger"}`}
                          disabled=${busy}
                          onClick=${() => void run(
                            () => users.update(editing.id, { disabled: !editing.disabled }),
                            () => setEditing(null),
                          )}>
                    ${editing.disabled ? "Re-enable this account" : "Disable this account"}
                  </button>
                </div>`}
          </div>
        <//>`
      : null}

    ${resetting
      ? html`<${Modal}
          title=${`Reset password for ${resetting.name}`}
          submitLabel="Set password"
          busy=${busy}
          error=${formError}
          onClose=${() => { setResetting(null); setIssued(null); }}
          onSubmit=${(e: Event) => {
            e.preventDefault();
            const form = e.target as HTMLFormElement;
            const value = (form.elements.namedItem("pw") as HTMLInputElement).value;
            void run(
              async () => {
                await users.setPassword(resetting.id, value);
                setIssued({ name: resetting.name, password: value });
              },
              () => setResetting(null),
            );
          }}
        >
          <div class="form-grid">
            <${Field} label="New password" wide=${true}
                      hint="At least 12 characters. It signs them out everywhere and clears any lockout.">
              <div class="pw-row">
                <input name="pw" required minLength=${12} value=${suggestPassword()} />
              </div>
            <//>
          </div>
        <//>`
      : null}

    ${issued
      ? html`<div class="card pad issued">
          <div class="section-title"><h2>Password for ${issued.name}</h2></div>
          <p class="muted">
            Give this to them directly. It is shown once and cannot be read back
            afterwards. The email they receive says the account exists, but never
            contains the password.
          </p>
          <code class="issued-pw">${issued.password}</code>
          <div style="margin-top:12px">
            <button class="btn" onClick=${() => setIssued(null)}>Done</button>
          </div>
        </div>`
      : null}
  </>`;
}
