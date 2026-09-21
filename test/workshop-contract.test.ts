import { describe, expect, it, vi } from "vitest";

vi.mock("@cloudflare/sandbox", () => ({ getSandbox: vi.fn() }));

import {
  CloudflareSandboxService,
  FIXTURE_REPOSITORY_URL,
  MAX_FILE_BYTES,
  MAX_LISTED_FILES,
  TEST_TIMEOUT_MS,
  WORKSPACE_ROOT,
  normalizeWorkspacePath,
  sandboxIdSchema,
  type SandboxClient,
} from "../src/services/sandbox.js";

function client(overrides: Partial<SandboxClient> = {}): SandboxClient {
  return {
    exists: vi.fn().mockResolvedValue({ exists: false }),
    gitCheckout: vi.fn().mockResolvedValue(undefined),
    listFiles: vi.fn().mockResolvedValue({
      files: [
        {
          absolutePath: `${WORKSPACE_ROOT}/src/order.js`,
          relativePath: "src/order.js",
          type: "file",
          size: 200,
        },
      ],
    }),
    readFile: vi.fn().mockResolvedValue({ content: "not available in the starter" }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockResolvedValue({ success: true, stdout: "", stderr: "", exitCode: 0 }),
    startProcess: vi.fn().mockResolvedValue({
      id: "preview-process",
      getStatus: vi.fn().mockResolvedValue("running"),
      getLogs: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
    }),
    containerFetch: vi.fn().mockResolvedValue(new Response("ok")),
    destroy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("code review starter contract", () => {
  it("preserves lowercase sandbox IDs and workspace path containment", () => {
    expect(sandboxIdSchema.parse("review-session-1")).toBe("review-session-1");
    expect(() => sandboxIdSchema.parse("Review-Session")).toThrow();
    expect(normalizeWorkspacePath("src/../test/order.test.js")).toEqual({
      ok: true,
      data: `${WORKSPACE_ROOT}/test/order.test.js`,
    });
    expect(normalizeWorkspacePath("../../etc/passwd")).toMatchObject({
      ok: false,
      error: { code: "INVALID_PATH" },
    });
  });

  it("clones only the bundled fixture and provides one complete bounded listing example", async () => {
    const gitCheckout = vi.fn().mockResolvedValue(undefined);
    const listFiles = vi.fn().mockResolvedValue({
      files: Array.from({ length: MAX_LISTED_FILES + 1 }, (_, index) => ({
        absolutePath: `${WORKSPACE_ROOT}/src/file-${String(index)}.js`,
        relativePath: `src/file-${String(index)}.js`,
        type: "file" as const,
        size: 1,
      })),
    });
    const service = new CloudflareSandboxService(
      "review-session",
      client({ gitCheckout, listFiles }),
    );

    await expect(service.cloneRepository()).resolves.toMatchObject({
      ok: true,
      data: { repository: "order-service", path: WORKSPACE_ROOT },
    });
    expect(gitCheckout).toHaveBeenCalledWith(FIXTURE_REPOSITORY_URL, {
      targetDir: WORKSPACE_ROOT,
      depth: 1,
      cloneTimeoutMs: TEST_TIMEOUT_MS,
    });

    const listing = await service.listFiles();
    expect(listing).toMatchObject({ ok: true, data: { path: ".", truncated: true } });
    if (listing.ok) expect(listing.data.files).toHaveLength(MAX_LISTED_FILES);
  });

  it("returns typed NOT_IMPLEMENTED results for the repair loop without bypassing guards", async () => {
    const readFile = vi.fn();
    const writeFile = vi.fn();
    const exec = vi.fn();
    const service = new CloudflareSandboxService(
      "review-session",
      client({ readFile, writeFile, exec }),
    );

    await expect(service.readFile("src/order.js")).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_IMPLEMENTED" },
    });
    await expect(
      service.writeFile("src/order.js", "export const value = 1;"),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_IMPLEMENTED" },
    });
    await expect(service.runTests()).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_IMPLEMENTED" },
    });
    await expect(service.getDiff()).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_IMPLEMENTED" },
    });
    await expect(service.readFile("../outside.js")).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_PATH" },
    });
    await expect(
      service.writeFile("src/order.js", "x".repeat(MAX_FILE_BYTES + 1)),
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_TOO_LARGE" } });
    expect(readFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });
});
