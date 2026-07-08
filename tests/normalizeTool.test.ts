import { describe, it, expect } from "vitest";
import { normalizeTool } from "../shared/schema.js";

describe("normalizeTool", () => {
  it("buckets file-reading tools as read_file", () => {
    // Representative names across platforms.
    expect(normalizeTool("read_file")).toBe("read_file"); // cursor
    expect(normalizeTool("Read")).toBe("read_file"); // claude
    expect(normalizeTool("codebase_search")).toBe("read_file"); // cursor semantic search
    expect(normalizeTool("glob_file_search")).toBe("read_file");
    expect(normalizeTool("open_file")).toBe("read_file");
  });

  it("buckets terminal/shell tools as run_terminal_cmd", () => {
    expect(normalizeTool("run_terminal_cmd")).toBe("run_terminal_cmd"); // cursor
    expect(normalizeTool("Bash")).toBe("run_terminal_cmd"); // claude
    expect(normalizeTool("shell")).toBe("run_terminal_cmd");
    expect(normalizeTool("exec")).toBe("run_terminal_cmd");
  });

  it("buckets mcp tools as mcp", () => {
    expect(normalizeTool("mcp_linear_create_issue")).toBe("mcp"); // cursor mcp naming
    expect(normalizeTool("mcp__github__create_pr")).toBe("mcp"); // claude mcp naming
    expect(normalizeTool("MCP-Slack")).toBe("mcp");
  });

  it("buckets web/fetch tools as web", () => {
    expect(normalizeTool("web_search")).toBe("web"); // cursor
    expect(normalizeTool("WebFetch")).toBe("web"); // claude
    expect(normalizeTool("fetch")).toBe("web");
    expect(normalizeTool("browser_navigate")).toBe("web");
    expect(normalizeTool("http_request")).toBe("web");
  });

  it("falls back to other for anything unrecognized", () => {
    expect(normalizeTool("edit_file")).toBe("other");
    expect(normalizeTool("todo_write")).toBe("other");
    expect(normalizeTool("Write")).toBe("other");
    expect(normalizeTool("apply_patch")).toBe("other");
  });

  it("returns undefined for missing/empty input", () => {
    expect(normalizeTool(undefined)).toBeUndefined();
    expect(normalizeTool("")).toBeUndefined();
  });
});
