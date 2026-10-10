import { query } from "../db/pool.js";
import { readPack } from "../lib/pack.js";
import { runChecks, hasCheck, type CheckResult } from "./checks.js";

/**
 * The readiness journey: the plan, plus where the customer has got to.
 *
 * Assembled in one place because three screens need the same answer — the
 * journey screen, the dashboard's progress figure and the printed plan — and
 * three implementations of "is this stage finished" would eventually disagree
 * with each other in front of a customer.
 */

/** One task, as the pack writes it. */
export interface PackTask {
  id: string;
  title: string;
  /** What to do, in plain English. */
  do: string;
  /** Why it matters. The part that gets people to actually do it. */
  why: string;
  /** Name of an automatic check, if the product can answer this itself. */
  check?: string;
  /** Route to send them to, without the hash. */
  goto?: string;
  /**
   * The clause of the standard this step satisfies, where the framework
   * numbers its management system. Shown on the step, so somebody asked
   * "where do you cover 9.2?" can answer from the screen.
   */
  clause?: string;
  /**
   * The file name of the policy template that gives this step a start, where
   * the step is "write this document". The screen looks the title up in the
   * pack's template index and links to the Templates tab in Policies.
   */
  template?: string;
}

export interface PackStage {
  id: string;
  name: string;
  aim: string;
  tasks: PackTask[];
}

export interface PackJourney {
  title: string;
  intro: string;
  stages: PackStage[];
}

/**
 * What a task is in.
 *
 * `done` and `not_applicable` are settled. `outstanding` is everything else,
 * including a task whose automatic check has not passed yet — there is no
 * separate "failing" state, because from the customer's point of view "not
 * done" and "not done and we checked" are the same job.
 */
export type TaskState = "done" | "not_applicable" | "outstanding";

export interface TaskView extends PackTask {
  /** Who is doing it, and where reminders go. Empty until somebody assigns it. */
  owner: string;
  ownerEmail: string;
  dueDate: string | null;
  state: TaskState;
  /** True when the product decided this, false when a person did. */
  automatic: boolean;
  /** One line of context, from the check or from whoever marked it. */
  detail: string;
  /** Why it was marked as not applying. Empty otherwise. */
  reason: string;
  updatedAt: string;
  actorName: string;
}

export interface StageView {
  id: string;
  name: string;
  aim: string;
  tasks: TaskView[];
  /** Tasks that count: everything except the ones ruled out. */
  applicable: number;
  done: number;
  /** Share of applicable tasks done, 0-100. A stage with nothing applicable is 100. */
  pct: number;
  complete: boolean;
}

export interface JourneyView {
  title: string;
  intro: string;
  stages: StageView[];
  applicable: number;
  done: number;
  pct: number;
  /**
   * The stage we suggest they look at next: the first incomplete one.
   *
   * A suggestion, not a gate. Nothing is locked — a customer who wants to
   * write their policies before assessing anything is allowed to, and being
   * told "finish stage 1 first" by software that cannot see their week is the
   * fastest way to make them stop using it.
   */
  suggested: string | null;
}

/** The stored answer for one task, where somebody has given one. */
interface StoredTask {
  task_id: string;
  state: "outstanding" | "done" | "not_applicable";
  reason: string;
  owner: string;
  owner_email: string | null;
  due_date: string | null;
  actor_name: string;
  updated_at: string;
}

export const loadPackJourney = (): Promise<PackJourney> => readPack<PackJourney>("journey.json");

/**
 * One task from the pack, by id.
 *
 * Callers need the task itself and not merely whether it exists, because what
 * may be done to a task depends on whether it carries an automatic check.
 */
export async function findTask(id: string): Promise<PackTask | undefined> {
  const journey = await loadPackJourney();
  return journey.stages.flatMap((s) => s.tasks).find((t) => t.id === id);
}

export async function buildJourney(): Promise<JourneyView> {
  const journey = await loadPackJourney();

  const stored = new Map<string, StoredTask>();
  for (const row of (await query<StoredTask>("select * from journey_tasks")).rows) {
    stored.set(row.task_id, row);
  }

  const checks = await runChecks(
    journey.stages.flatMap((s) => s.tasks.map((t) => t.check ?? "").filter(Boolean)),
  );

  const stages: StageView[] = journey.stages.map((stage) => {
    const tasks = stage.tasks.map((task) => view(task, stored.get(task.id), checks));
    const applicable = tasks.filter((t) => t.state !== "not_applicable").length;
    const done = tasks.filter((t) => t.state === "done").length;
    return {
      id: stage.id,
      name: stage.name,
      aim: stage.aim,
      tasks,
      applicable,
      done,
      pct: applicable === 0 ? 100 : Math.round((done / applicable) * 100),
      complete: done === applicable,
    };
  });

  const applicable = stages.reduce((n, s) => n + s.applicable, 0);
  const done = stages.reduce((n, s) => n + s.done, 0);

  return {
    title: journey.title,
    intro: journey.intro,
    stages,
    applicable,
    done,
    pct: applicable === 0 ? 100 : Math.round((done / applicable) * 100),
    suggested: stages.find((s) => !s.complete)?.id ?? null,
  };
}

/**
 * Settles one task.
 *
 * Ruling something out always wins, whatever a check says: an automatic check
 * that keeps turning a deliberately excluded task green would be arguing with
 * the customer about their own business. Beyond that, a check decides where
 * there is one, and the stored tick decides where there is not.
 */
function view(
  task: PackTask,
  row: StoredTask | undefined,
  checks: Record<string, CheckResult>,
): TaskView {
  const base = {
    ...task,
    owner: row?.owner ?? "",
    ownerEmail: row?.owner_email ?? "",
    dueDate: row?.due_date ?? null,
    reason: row?.reason ?? "",
    updatedAt: row?.updated_at ?? "",
    actorName: row?.actor_name ?? "",
  };

  if (row?.state === "not_applicable") {
    return { ...base, state: "not_applicable", automatic: false, detail: row.reason };
  }

  const check = task.check && hasCheck(task.check) ? checks[task.check] : undefined;
  if (check) {
    return {
      ...base,
      state: check.done ? "done" : "outstanding",
      automatic: true,
      detail: check.detail,
    };
  }

  return {
    ...base,
    state: row?.state === "done" ? "done" : "outstanding",
    automatic: false,
    detail: row?.state === "done" && row.actor_name ? `marked done by ${row.actor_name}` : "",
  };
}
