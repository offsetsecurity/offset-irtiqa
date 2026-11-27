import type { FastifyRequest } from "fastify";

/**
 * How long one request may take to arrive.
 *
 * The server-wide limit (REQUEST_TIMEOUT_MS) has to allow a multi-gigabyte
 * backup to be uploaded, so it is an hour. That let anyone who can reach the
 * port hold a connection for an hour by sending a byte now and then (go-live
 * review, 15 Nov 2026). So every request that carries a body gets its own,
 * shorter limit (BODY_TIMEOUT_MS) for the body to arrive in full; only the
 * administrator's backup routes lift it, with noIdleTimeout below.
 */
const timers = new WeakMap<object, NodeJS.Timeout>();

const hasBody = (request: Pick<FastifyRequest, "headers">): boolean => {
  const length = Number(request.headers["content-length"] ?? 0);
  return length > 0 || request.headers["transfer-encoding"] !== undefined;
};

export function startBodyTimer(request: FastifyRequest, ms: number): void {
  if (!hasBody(request)) return;
  const raw = request.raw;
  const timer = setTimeout(() => {
    request.log.warn({ ms }, "the request body did not arrive in time; connection closed");
    raw.destroy();
  }, ms);
  timer.unref();
  timers.set(request, timer);
  const stop = () => stopBodyTimer(request);
  raw.once("end", stop);
  raw.once("close", stop);
}

export function stopBodyTimer(request: object): void {
  const timer = timers.get(request);
  if (timer) {
    clearTimeout(timer);
    timers.delete(request);
  }
}

/**
 * For a request that is allowed to be slow or silent for a long time: putting
 * back a large backup, or making one. The idle timeout
 * (SOCKET_IDLE_TIMEOUT_MS) closes a connection that says nothing for five
 * minutes, and the body limit above closes one whose body is slow to arrive;
 * both are right for a stranger who stalls and wrong for an administrator
 * waiting for a multi-gigabyte restore. These routes need an administrator,
 * so the exemption is not open to a stranger.
 */
export function noIdleTimeout(request: Pick<FastifyRequest, "raw">): void {
  stopBodyTimer(request);
  // A request made inside the process (the tests, and the approval of a
  // suggestion) has a stand-in socket with no timer to switch off.
  const socket = request.raw.socket;
  if (socket && typeof socket.setTimeout === "function") socket.setTimeout(0);
}
