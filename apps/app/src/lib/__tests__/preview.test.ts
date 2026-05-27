import { describe, it, expect } from "bun:test";
import { parseInputPreview } from "../events/preview";

describe("parseInputPreview", () => {
  it("returns null when both toolName and rawPreview are missing", () => {
    expect(parseInputPreview(null, null)).toBeNull();
    expect(parseInputPreview(null, undefined)).toBeNull();
    expect(parseInputPreview(null, "")).toBeNull();
  });

  // --- File tools: Read / Edit / Write / MultiEdit / NotebookEdit ---

  it("extracts file_path from a valid Read JSON preview", () => {
    const result = parseInputPreview(
      "Read",
      JSON.stringify({ file_path: "src/foo.ts" })
    );
    expect(result?.kind).toBe("file");
    expect(result?.primary).toBe("src/foo.ts");
  });

  it("shortens long file_paths to last two segments", () => {
    const longPath =
      "/Users/noboa/Business/Pando/trenchcoat/Engineering/trenchcoat-app/apps/app/src/app/(dashboard)/sessions/[id]/page.tsx";
    const result = parseInputPreview(
      "Edit",
      JSON.stringify({ file_path: longPath })
    );
    expect(result?.kind).toBe("file");
    expect(result?.primary).toContain("[id]/page.tsx");
    expect((result?.primary ?? "").length).toBeLessThan(longPath.length);
  });

  it("extracts file_path from a truncated JSON preview using regex fallback", () => {
    // Simulates a preview that hit the 100-char cap and ends in "..."
    const raw =
      '{"file_path": "apps/app/src/lib/events/grouping.ts", "old_string": "throw new Error(\\"not implemented\\"); cons...';
    const result = parseInputPreview("Edit", raw);
    expect(result?.kind).toBe("file");
    expect(result?.primary).toBe("apps/app/src/lib/events/grouping.ts");
  });

  it("works for Write tool", () => {
    const result = parseInputPreview(
      "Write",
      JSON.stringify({ file_path: "out.md", content: "hello" })
    );
    expect(result?.kind).toBe("file");
    expect(result?.primary).toBe("out.md");
  });

  it("works for MultiEdit tool", () => {
    const result = parseInputPreview(
      "MultiEdit",
      JSON.stringify({ file_path: "x.ts" })
    );
    expect(result?.kind).toBe("file");
    expect(result?.primary).toBe("x.ts");
  });

  it("works for NotebookEdit tool", () => {
    const result = parseInputPreview(
      "NotebookEdit",
      JSON.stringify({ file_path: "nb.ipynb" })
    );
    expect(result?.kind).toBe("file");
    expect(result?.primary).toBe("nb.ipynb");
  });

  // --- Bash ---

  it("extracts command from a Bash preview", () => {
    const result = parseInputPreview(
      "Bash",
      JSON.stringify({ command: "bun test", description: "Run tests" })
    );
    expect(result?.kind).toBe("bash");
    expect(result?.primary).toBe("bun test");
  });

  it("extracts command from a truncated Bash preview", () => {
    const raw =
      '{"command": "grep -r \\"parseToken\\" apps/app/src", "description": "Search for parseTok...';
    const result = parseInputPreview("Bash", raw);
    expect(result?.kind).toBe("bash");
    expect(result?.primary).toContain("grep");
    expect(result?.primary).toContain("parseToken");
  });

  // --- Grep ---

  it("extracts pattern and path for Grep", () => {
    const result = parseInputPreview(
      "Grep",
      JSON.stringify({ pattern: "parseToken", path: "apps/app/src" })
    );
    expect(result?.kind).toBe("grep");
    expect(result?.primary).toBe("parseToken");
    expect(result?.secondary).toBe("apps/app/src");
  });

  it("extracts pattern only for Grep when path is missing", () => {
    const result = parseInputPreview(
      "Grep",
      JSON.stringify({ pattern: "foo" })
    );
    expect(result?.kind).toBe("grep");
    expect(result?.primary).toBe("foo");
    expect(result?.secondary == null).toBe(true);
  });

  // --- Glob ---

  it("extracts pattern and path for Glob", () => {
    const result = parseInputPreview(
      "Glob",
      JSON.stringify({ pattern: "**/*.ts", path: "src" })
    );
    expect(result?.kind).toBe("glob");
    expect(result?.primary).toBe("**/*.ts");
    expect(result?.secondary).toBe("src");
  });

  // --- Raw fallback ---

  it("falls back to raw preview for unknown tools", () => {
    const result = parseInputPreview(
      "UnknownTool",
      JSON.stringify({ foo: "bar" })
    );
    expect(result?.kind).toBe("raw");
    expect(result?.primary).toContain("foo");
  });

  it("truncates raw fallback to 60 chars", () => {
    const longString = "x".repeat(200);
    const result = parseInputPreview("UnknownTool", longString);
    expect(result?.kind).toBe("raw");
    expect((result?.primary ?? "").length).toBeLessThanOrEqual(60);
  });

  it("returns raw fallback when toolName matches a file tool but no file_path is present", () => {
    const result = parseInputPreview(
      "Read",
      JSON.stringify({ offset: 10 })
    );
    expect(result?.kind).toBe("raw");
  });

  it("returns kind=raw with null primary when toolName is set but preview is empty", () => {
    const result = parseInputPreview("Read", "");
    // toolName is non-null so we return a result, but primary may be null.
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("raw");
    expect(result?.primary).toBeNull();
  });

  it("handles null toolName with a non-empty preview", () => {
    const result = parseInputPreview(null, '{"foo": "bar"}');
    expect(result?.kind).toBe("raw");
    expect(result?.primary).toBeTruthy();
  });
});
