import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReviewDashboard } from "../src/client/components/review-dashboard.js";

describe("ReviewDashboard", () => {
  it("renders the complete review workflow", () => {
    const html = renderToStaticMarkup(
      <ReviewDashboard
        state={
          {
            status: "complete",
            repository: {
              name: "peer-point/sample-repo",
              url: "https://github.com/peer-point/sample-repo",
              ref: "a1b2c3d",
              sandboxId: "sandbox-review-1",
              path: "/workspace/sample-repo",
            },
            inspectedFiles: ["src/cart.ts", "test/cart.test.ts"],
            changedFiles: ["src/cart.ts"],
            testRuns: [
              {
                id: "test-red",
                command: "npm test",
                exitCode: 1,
                summary: "Expected cents, received dollars",
              },
              {
                id: "test-green",
                command: "npm test",
                exitCode: 0,
                summary: "12 tests passed",
              },
            ],
            diff: "diff --git a/src/cart.ts b/src/cart.ts\n-old total\n+new total",
            previewUrl: "https://review-preview.example.com",
            findings: [
              {
                id: "finding-1",
                severity: "high",
                title: "Currency conversion used the wrong unit",
                summary: "The patch converts the total to cents before comparison.",
                file: "src/cart.ts",
                line: 42,
              },
            ],
            turnCount: 6,
          } as never
        }
      />,
    );

    expect(html).toContain("Repository &amp; sandbox");
    expect(html).toContain("peer-point/sample-repo");
    expect(html).toContain("sandbox-review-1");
    expect(html).toContain("Test history");
    expect(html.indexOf("Failed")).toBeLessThan(html.indexOf("Passed"));
    expect(html).toContain("src/cart.ts");
    expect(html).toContain("Patch diff");
    expect(html).toContain("review-diff__line--deletion");
    expect(html).toContain("review-diff__line--addition");
    expect(html).toContain('href="https://review-preview.example.com/"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("Currency conversion used the wrong unit");
    expect(html).toContain("src/cart.ts:42");
  });

  it("shows actionable empty states and does not link an unsafe preview URL", () => {
    const html = renderToStaticMarkup(
      <ReviewDashboard
        state={
          {
            status: "idle",
            repository: null,
            inspectedFiles: [],
            changedFiles: [],
            testRuns: [],
            diff: "",
            previewUrl: "javascript:alert(1)",
            findings: [],
            turnCount: 0,
          } as never
        }
      />,
    );

    expect(html).toContain("Waiting for repository");
    expect(html).toContain("No tests run yet");
    expect(html).toContain("No files inspected yet");
    expect(html).toContain("No files changed yet");
    expect(html).toContain("No patch recorded yet");
    expect(html).toContain("No preview URL exposed");
    expect(html).toContain("No findings recorded yet");
    expect(html).not.toContain("javascript:alert(1)");
  });

  it("bounds long file, test, diff, and finding collections", () => {
    const html = renderToStaticMarkup(
      <ReviewDashboard
        state={
          {
            status: "running",
            repository: "peer-point/sample-repo",
            inspectedFiles: Array.from(
              { length: 15 },
              (_, index) => `src/file-${String(index + 1)}.ts`,
            ),
            changedFiles: [],
            testRuns: Array.from({ length: 10 }, (_, index) => ({
              id: `run-${String(index + 1)}`,
              command: `test-run-${String(index + 1)}`,
              exitCode: index === 9 ? 0 : 1,
            })),
            diff: Array.from({ length: 305 }, (_, index) => `+line ${String(index + 1)}`).join(
              "\n",
            ),
            previewUrl: null,
            findings: Array.from({ length: 10 }, (_, index) => ({
              id: `finding-${String(index + 1)}`,
              title: `Finding ${String(index + 1)}`,
            })),
            turnCount: 10,
          } as never
        }
      />,
    );

    expect(html).not.toContain("src/file-1.ts");
    expect(html).toContain("src/file-15.ts");
    expect(html).not.toContain(">test-run-1<");
    expect(html).toContain("test-run-10");
    expect(html).toContain("Diff truncated after 300 lines");
    expect(html).toContain("Showing first 8 findings");
    expect(html).not.toContain("Finding 9");
  });
});
