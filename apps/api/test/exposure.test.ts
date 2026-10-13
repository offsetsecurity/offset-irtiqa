import { describe, it, expect } from "vitest";
import { isLoopbackHost } from "../src/config.js";

/**
 * Which machines can reach this.
 *
 * The product used to listen on 0.0.0.0 with no TLS and no comment, so a fresh
 * install answered the whole office network and every password crossed it as
 * readable text. The default is now loopback, and opening it up requires either
 * a certificate or somebody explicitly saying a proxy is handling TLS.
 *
 * `isLoopbackHost` is the thing that decides which of those is happening, so it
 * is worth being sure it cannot be fooled into calling a public address safe.
 */
describe("deciding whether a host is only this machine", () => {
  it("recognises the loopback addresses", () => {
    for (const host of [
      "127.0.0.1",
      "localhost",
      "LOCALHOST",
      "::1",
      "[::1]",
      "127.0.0.53",
      "127.1.2.3",
      "  127.0.0.1  ",
    ]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("does not mistake a routable address for a local one", () => {
    for (const host of [
      "0.0.0.0",
      "::",
      "192.168.1.34",
      "10.0.0.5",
      "203.0.113.7",
      "grc.example.com",
      // The dangerous near-misses: these are real, routable addresses that
      // merely start with something familiar.
      "127.example.com",
      "1.2.7.0",
      "12.7.0.1",
    ]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});
