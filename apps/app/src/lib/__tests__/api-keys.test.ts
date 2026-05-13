import { describe, it, expect } from "bun:test";
import { generateApiKey, hashApiKey } from "../api-keys";
import { hasRequiredScopes, requireScopes } from "../../types/api-keys";

// --- generateApiKey ---

describe("generateApiKey", () => {
  it("plaintext starts with 'ct_live_'", () => {
    expect(generateApiKey().plaintext).toMatch(/^ct_live_/);
  });

  it("plaintext is exactly 40 characters", () => {
    expect(generateApiKey().plaintext.length).toBe(40);
  });

  it("prefix equals the first 12 characters of plaintext", () => {
    const { plaintext, prefix } = generateApiKey();
    expect(prefix).toBe(plaintext.substring(0, 12));
  });

  it("hash is a non-empty string", () => {
    expect(generateApiKey().hash.length).toBeGreaterThan(0);
  });

  it("generates unique keys on each call", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });
});

// --- hashApiKey ---

describe("hashApiKey", () => {
  it("returns a 64-character lowercase hex string (SHA-256)", () => {
    expect(hashApiKey("ct_live_test")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const key = "ct_live_somekey";
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashApiKey("ct_live_aaa")).not.toBe(hashApiKey("ct_live_bbb"));
  });
});

// --- hasRequiredScopes ---

describe("hasRequiredScopes", () => {
  it("returns true when all required scopes are present", () => {
    expect(hasRequiredScopes(["read:events", "write:events"], ["read:events"])).toBe(true);
  });

  it("returns true when multiple required scopes are all present", () => {
    expect(hasRequiredScopes(["read:events", "write:events"], ["read:events", "write:events"])).toBe(true);
  });

  it("returns false when a required scope is missing", () => {
    expect(hasRequiredScopes(["read:events"], ["write:events"])).toBe(false);
  });

  it("admin scope bypasses all scope requirements", () => {
    expect(hasRequiredScopes(["admin"], ["write:events", "read:analytics"])).toBe(true);
  });

  it("returns true when no scopes are required", () => {
    expect(hasRequiredScopes([], [])).toBe(true);
  });

  it("returns false when key has no scopes but scopes are required", () => {
    expect(hasRequiredScopes([], ["read:events"])).toBe(false);
  });
});

// --- requireScopes ---

describe("requireScopes", () => {
  it("returns null when scopes satisfy all requirements", () => {
    expect(requireScopes({ scopes: ["read:events"] }, ["read:events"])).toBeNull();
  });

  it("returns an error string listing the missing scope", () => {
    const result = requireScopes({ scopes: ["read:events"] }, ["write:events"]);
    expect(typeof result).toBe("string");
    expect(result).toContain("write:events");
  });

  it("returns 'No scopes available' when scopes is undefined", () => {
    expect(requireScopes({}, ["read:events"])).toBe("No scopes available");
  });

  it("returns null for admin scope regardless of requirements", () => {
    expect(requireScopes({ scopes: ["admin"] }, ["write:events", "read:analytics"])).toBeNull();
  });

  it("returns null when no scopes are required", () => {
    expect(requireScopes({ scopes: [] }, [])).toBeNull();
  });
});
