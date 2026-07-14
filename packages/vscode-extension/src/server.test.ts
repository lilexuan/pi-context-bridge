import { describe, expect, it } from "vitest";
import { isAuthorized } from "./auth.js";

describe("bridge authorization", () => {
  it("accepts the exact bearer token", () => expect(isAuthorized("Bearer secret", "secret")).toBe(true));
  it("rejects missing, malformed, and incorrect tokens", () => {
    expect(isAuthorized(undefined, "secret")).toBe(false);
    expect(isAuthorized("Basic secret", "secret")).toBe(false);
    expect(isAuthorized("Bearer nope", "secret")).toBe(false);
  });
});
