import { describe, expect, it, vi } from "vitest";

vi.mock("@cloudflare/sandbox", () => ({ getSandbox: vi.fn() }));

import {
  CHANGED_FILES_LIMIT,
  FINDINGS_LIMIT,
  INSPECTED_FILES_LIMIT,
  TEST_RUNS_LIMIT,
  appendFinding,
  appendTestRun,
  codeReviewStateSchema,
  createInitialState,
  recordFileChanged,
  recordFileInspected,
  setDiff,
  setPreview,
  setRepositoryLifecycle,
  setReviewStatus,
} from "../src/agent/state.js";

const testRun = {
  success: false,
  exitCode: 1,
  stdout: "one test failed",
  stderr: "",
  truncated: false,
};

describe("code review state", () => {
  it("creates a valid fixed-repository state with a lowercase sandbox ID", () => {
    expect(codeReviewStateSchema.parse(createInitialState("review-session"))).toMatchObject({
      sandboxId: "review-session",
      repository: {
        name: "order-service",
        source: "file:///opt/fixtures/order-service",
        workspace: "/workspace/review",
        lifecycle: "not-cloned",
      },
      status: "idle",
      filesInspected: [],
      filesChanged: [],
      testRuns: [],
      findings: [],
      preview: null,
    });
    expect(() => createInitialState("Review-Session")).toThrow();
  });

  it("tracks lifecycle and review status", () => {
    const ready = setRepositoryLifecycle(createInitialState(), "ready");
    const testing = setReviewStatus(ready, "testing");

    expect(testing.repository.lifecycle).toBe("ready");
    expect(testing.status).toBe("testing");
  });

  it("deduplicates and bounds inspected and changed files", () => {
    let state = createInitialState();
    for (let index = 0; index < INSPECTED_FILES_LIMIT + 2; index += 1) {
      state = recordFileInspected(state, `src/file-${String(index)}.js`);
    }
    state = recordFileInspected(state, "src/file-2.js");
    for (let index = 0; index < CHANGED_FILES_LIMIT + 2; index += 1) {
      state = recordFileChanged(state, `src/change-${String(index)}.js`);
    }

    expect(state.filesInspected).toHaveLength(INSPECTED_FILES_LIMIT);
    expect(state.filesInspected.at(-1)).toBe("src/file-2.js");
    expect(state.filesChanged).toHaveLength(CHANGED_FILES_LIMIT);
    expect(state.filesChanged[0]).toBe("src/change-2.js");
    expect(() => recordFileChanged(state, "../outside.js")).toThrow();
  });

  it("bounds test runs while preserving failing and passing results", () => {
    let state = createInitialState();
    for (let index = 0; index < TEST_RUNS_LIMIT + 2; index += 1) {
      state = appendTestRun(state, {
        ...testRun,
        success: index === TEST_RUNS_LIMIT + 1,
        exitCode: index === TEST_RUNS_LIMIT + 1 ? 0 : 1,
      });
    }

    expect(state.testRuns).toHaveLength(TEST_RUNS_LIMIT);
    expect(state.testRuns[0]?.success).toBe(false);
    expect(state.testRuns.at(-1)?.success).toBe(true);
  });

  it("tracks bounded diff and preview metadata", () => {
    let state = setDiff(createInitialState(), "diff --git a/src/order.js b/src/order.js", false);
    state = setPreview(state, {
      url: "https://fixture.trycloudflare.com",
      port: 8080,
      processId: "preview-process",
    });

    expect(state.diff).toContain("src/order.js");
    expect(state.diffTruncated).toBe(false);
    expect(state.preview).toMatchObject({ port: 8080 });
    expect(() =>
      setPreview(state, {
        url: "https://fixture.trycloudflare.com",
        port: 3000,
        processId: "preview-process",
      } as never),
    ).toThrow();
  });

  it("bounds validated findings", () => {
    let state = createInitialState();
    for (let index = 0; index < FINDINGS_LIMIT + 2; index += 1) {
      state = appendFinding(state, {
        title: `Discount defect ${String(index)}`,
        severity: "critical",
        summary: "The discount rate is added instead of subtracted.",
        file: "src/order.js",
        line: 5,
      });
    }

    expect(state.findings).toHaveLength(FINDINGS_LIMIT);
    expect(state.findings[0]?.title).toBe("Discount defect 2");
    expect(() =>
      appendFinding(state, {
        title: "Invalid line",
        severity: "warning",
        summary: "A line without a file is not grounded.",
        line: 4,
      }),
    ).toThrow();
  });
});
