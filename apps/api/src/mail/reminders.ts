import { query } from "../db/pool.js";
import { product } from "../config.js";

/**
 * Finding the people who owe something, and writing to them.
 *
 * Four things can be owed - a control, a task, a step of the readiness plan, a
 * piece of evidence due for review - and so can every register's own dated
 * records: a policy review, a supplier review, an objective, an audit. All are
 * chased the same way, because from the recipient's side there is no
 * difference. They owe something, it has a date, and the date is near or past.
 *
 * One email per thing, never a list. Somebody with three overdue items gets
 * three emails, each about one thing, so each can be answered or filed on its
 * own. (Escalation, in escalation.ts, decides who else hears about it once it
 * is overdue.)
 *
 * Nothing is sent for anything without both a date and an address. A date with
 * nobody to tell, and an address with no deadline, are each harmless on their
 * own; only together are they an instruction to chase someone.
 */

/** What kind of thing is owed. Only used to word the email. */
export type ItemKind = "control" | "task" | "step" | "evidence" | "record";

export interface DueItem {
  kind: ItemKind;
  /**
   * Which row this is, stable when its title is edited: the table and the id.
   * What the reminder log is keyed on.
   */
  key: string;
  /** "3.8.3", "Task 14", "Turn on email" - whatever identifies it to the owner. */
  ref: string;
  title: string;
  due_date: string;
  owner: string;
  owner_email: string;
  /** One short line of context, such as the current maturity level. */
  detail: string;
}

export interface Reminder {
  to: string;
  subject: string;
  text: string;
}

/**
 * When the person who owns it is written to: 30, 15, 7 and 3 days before, on
 * the day, and then every day it stays late.
 */
export const REMIND_BEFORE = [30, 15, 7, 3] as const;

/** Plain date arithmetic on ISO strings, which is all these ever are. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `earlier` to `later`. Negative when `later` comes first. */
export function daysBetween(later: string, earlier: string): number {
  return Math.round(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * Which reminder this is, or null when it is too early to say anything.
 *
 * "before-15" covers the whole stretch from 15 days out until 7 days out, so a
 * server that was switched off on the day itself still sends it the next day,
 * once. Each stage is recorded when sent and never repeated, except "after-N",
 * which is a different stage every day it stays late.
 */
export function stageFor(dueDate: string, today: string): string | null {
  const left = daysBetween(dueDate, today);
  if (left < 0) return `after-${-left}`;
  if (left === 0) return "on";
  const reached = REMIND_BEFORE.filter((s) => s >= left);
  return reached.length ? `before-${reached[reached.length - 1]}` : null;
}

/** Whether today is a day something with this date is worth saying anything about. */
export function isDueToday(dueDate: string, today: string): boolean {
  return stageFor(dueDate, today) !== null;
}

/**
 * Everything with a date and an address, from every place.
 *
 * Not narrowed to today here: the rule for "is it time to say something" lives
 * in stageFor, and the log decides whether it has already been said.
 */
export async function allItems(): Promise<DueItem[]> {
  const controls = await query<{
    id: string; ref: string; title: string; due_date: string; owner: string; owner_email: string;
    maturity: number | null; target_maturity: number | null;
  }>(
    `select id, ref, title, due_date, owner, owner_email, maturity, target_maturity
       from controls
      where owner_email is not null and owner_email <> ''
        and due_date is not null
        and status <> 'not_applicable'`,
  );

  const tasks = await query<{
    id: string; seq: number; title: string; due_date: string; owner: string; owner_email: string;
    status: string;
  }>(
    `select id, seq, title, due_date, owner, owner_email, status
       from tasks
      where owner_email is not null and owner_email <> ''
        and due_date is not null
        and status <> 'Done'`,
  );

  const evidence = await query<{
    id: string; name: string; next_review: string; owner: string; owner_email: string;
    file_name: string | null;
  }>(
    `select id, name, next_review, owner, owner_email, file_name
       from evidence
      where owner_email is not null and owner_email <> ''
        and next_review is not null`,
  );

  const steps = await query<{
    task_id: string; owner: string; owner_email: string; due_date: string; state: string;
  }>(
    `select task_id, owner, owner_email, due_date, state
       from journey_tasks
      where owner_email is not null and owner_email <> ''
        and due_date is not null
        and state <> 'done'
        and state <> 'not_applicable'`,
  );

  /**
   * The registers: each has a date that means "look at this again" and an
   * address. Finished things are left alone - an exited supplier, a met
   * objective, an audit already held.
   */
  const RECORDS: { ref: string; table: string; sql: string }[] = [
    { ref: "Policy review", table: "policies", sql: "select id, name as title, review_date as due, owner, owner_email from policies where review_date is not null" },
    { ref: "Supplier review", table: "vendors", sql: "select id, name as title, review_date as due, owner, owner_email from vendors where review_date is not null and status <> 'Exited'" },
    { ref: "Training due", table: "training", sql: "select id, person || case when course <> '' then ': ' || course else '' end as title, next_due as due, person as owner, owner_email from training where next_due is not null" },
    { ref: "Objective", table: "objectives", sql: "select id, title, due_date as due, owner, owner_email from objectives where due_date is not null and status not in ('Met', 'Missed')" },
    { ref: "Interested party review", table: "parties", sql: "select id, name as title, review_date as due, owner, owner_email from parties where review_date is not null" },
    { ref: "Audit or review", table: "reviews", sql: "select id, title, planned_date as due, led_by as owner, owner_email from reviews where planned_date is not null and status in ('Planned', 'In progress')" },
    { ref: "Communication", table: "communications", sql: "select id, topic as title, next_due as due, owner, owner_email from communications where next_due is not null" },
  ];
  const records: DueItem[] = [];
  for (const r of RECORDS) {
    const { rows } = await query<{ id: string; title: string; due: string; owner: string; owner_email: string }>(
      `select * from (${r.sql}) where owner_email is not null and owner_email <> ''`,
    );
    for (const row of rows) {
      records.push({
        kind: "record", key: `${r.table}:${row.id}`, ref: r.ref, title: row.title, due_date: row.due,
        owner: row.owner, owner_email: row.owner_email, detail: "due",
      });
    }
  }

  return [
    ...records,
    ...controls.rows.map((r) => ({
      kind: "control" as const,
      key: `controls:${r.id}`,
      ref: r.ref,
      title: r.title,
      due_date: r.due_date,
      owner: r.owner,
      owner_email: r.owner_email,
      detail:
        r.maturity === null
          ? "not scored yet"
          : `at level ${r.maturity}, target ${r.target_maturity ?? 3}`,
    })),
    ...tasks.rows.map((r) => ({
      kind: "task" as const,
      key: `tasks:${r.id}`,
      ref: `Task ${r.seq}`,
      title: r.title,
      due_date: r.due_date,
      owner: r.owner,
      owner_email: r.owner_email,
      detail: r.status.toLowerCase(),
    })),
    ...evidence.rows.map((r) => ({
      kind: "evidence" as const,
      key: `evidence:${r.id}`,
      ref: "Evidence",
      title: r.name,
      due_date: r.next_review,
      owner: r.owner,
      owner_email: r.owner_email,
      detail: r.file_name ? "due for review" : "due for review, no document attached",
    })),
    ...steps.rows.map((r) => ({
      kind: "step" as const,
      key: `journey_tasks:${r.task_id}`,
      ref: "Get ready",
      title: r.task_id,
      due_date: r.due_date,
      owner: r.owner,
      owner_email: r.owner_email,
      detail: "not done yet",
    })),
  ];
}

/** Whatever has a reminder moment today, soonest first. */
export async function dueItems(today: string): Promise<DueItem[]> {
  return (await allItems())
    .filter((i) => isDueToday(i.due_date, today))
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.ref.localeCompare(b.ref));
}

export const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "12 March 2027", the same in every locale. */
export const niceDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

/** The email to the person who owns one thing, at one stage. */
export function buildReminder(item: DueItem, stage: string, today: string): Reminder {
  const left = daysBetween(item.due_date, today);
  const what = `${item.ref}: ${item.title}`;

  let subject: string;
  let lead: string;
  if (stage.startsWith("after-")) {
    const n = -left;
    subject = `${product.name}: overdue by ${plural(n, "day")} - ${what}`;
    lead = `This was due on ${niceDate(item.due_date)} and is ${plural(n, "day")} overdue.`;
  } else if (stage === "on") {
    subject = `${product.name}: due today - ${what}`;
    lead = "This is due today.";
  } else {
    subject = `${product.name}: due in ${plural(left, "day")} - ${what}`;
    lead = `This is due on ${niceDate(item.due_date)}, in ${plural(left, "day")}.`;
  }

  const text = [
    item.owner ? `Hello ${item.owner},` : "Hello,",
    "",
    lead,
    "",
    `  ${what}`,
    `  ${item.detail}`,
    "",
    `Open it in ${product.name} to record what you have done, attach the`,
    "evidence, or change the date if it is no longer right.",
    "",
    "If this is not yours, clear the email address on it and these stop.",
    "",
  ].join("\n");

  return { to: item.owner_email.trim().toLowerCase(), subject, text };
}
