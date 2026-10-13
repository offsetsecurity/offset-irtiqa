import { logToFile } from "../config.js";
import { fileSink, type LogSink } from "./logging.js";

/**
 * signin.log: every refused sign-in, one plain line each.
 *
 * The audit trail already records them, but it lives inside the product, and
 * the person who most needs it is an administrator who cannot sign in, or a
 * support engineer who has been sent the log folder. This file sits beside the
 * other logs, is readable without the product, and rotates like they do.
 *
 * It never holds a password. The username is what was typed, so it is cleaned
 * of line breaks first: otherwise someone could type a fake log line into the
 * username box.
 */
let sink: LogSink | null = null;

const clean = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120);

export function noteSignIn(event: "FAILED" | "LOCKED" | "BLOCKED", username: string, address: string, reason: string): void {
  if (!logToFile) return;
  sink ??= fileSink("signin");
  sink.write(`${new Date().toISOString()}  ${event.padEnd(7)}  user=${clean(username)}  from=${clean(address)}  ${clean(reason)}`);
}
