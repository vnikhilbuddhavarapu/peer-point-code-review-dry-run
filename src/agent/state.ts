import { MODEL_IDS, modelIdSchema, type ModelId } from "@peer-point/workshop-config";
import { z } from "zod";

import {
  FIXTURE_REPOSITORY_URL,
  MAX_OUTPUT_BYTES,
  PREVIEW_PORT,
  sandboxIdSchema,
  WORKSPACE_ROOT,
} from "../shared/review-contracts.js";

export const INSPECTED_FILES_LIMIT = 50;
export const CHANGED_FILES_LIMIT = 25;
export const TEST_RUNS_LIMIT = 8;
export const FINDINGS_LIMIT = 12;

const relativeFilePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      path.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    "File path must be normalized and relative to the repository",
  );

export const repositoryLifecycleSchema = z.enum([
  "not-cloned",
  "cloning",
  "ready",
  "destroyed",
  "error",
]);
export type RepositoryLifecycle = z.infer<typeof repositoryLifecycleSchema>;

export const reviewStatusSchema = z.enum([
  "idle",
  "reviewing",
  "testing",
  "fixing",
  "complete",
  "error",
]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const testRunInputSchema = z
  .object({
    success: z.boolean(),
    exitCode: z.number().int(),
    stdout: z.string().max(MAX_OUTPUT_BYTES),
    stderr: z.string().max(MAX_OUTPUT_BYTES),
    truncated: z.boolean(),
  })
  .strict();
export type TestRunInput = z.infer<typeof testRunInputSchema>;

export const testRunSchema = testRunInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type TestRun = z.infer<typeof testRunSchema>;

export const findingSeveritySchema = z.enum(["info", "warning", "critical"]);
export const findingInputSchema = z
  .object({
    title: z.string().trim().min(3).max(100),
    severity: findingSeveritySchema,
    summary: z.string().trim().min(3).max(1_000),
    file: relativeFilePathSchema.optional(),
    line: z.number().int().positive().max(1_000_000).optional(),
  })
  .strict()
  .refine((finding) => finding.file !== undefined || finding.line === undefined, {
    message: "A line number requires a file path",
    path: ["line"],
  });
export type FindingInput = z.infer<typeof findingInputSchema>;

export const findingSchema = findingInputSchema.safeExtend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type Finding = z.infer<typeof findingSchema>;

export const previewSchema = z
  .object({
    url: z.url(),
    port: z.literal(PREVIEW_PORT),
    processId: z.string().min(1).max(100),
  })
  .strict();
export type Preview = z.infer<typeof previewSchema>;

export const codeReviewStateSchema = z
  .object({
    selectedModel: modelIdSchema,
    sandboxId: sandboxIdSchema,
    repository: z.object({
      name: z.literal("order-service"),
      source: z.literal(FIXTURE_REPOSITORY_URL),
      workspace: z.literal(WORKSPACE_ROOT),
      lifecycle: repositoryLifecycleSchema,
    }),
    status: reviewStatusSchema,
    filesInspected: z.array(relativeFilePathSchema).max(INSPECTED_FILES_LIMIT),
    filesChanged: z.array(relativeFilePathSchema).max(CHANGED_FILES_LIMIT),
    testRuns: z.array(testRunSchema).max(TEST_RUNS_LIMIT),
    diff: z.string().max(MAX_OUTPUT_BYTES),
    diffTruncated: z.boolean(),
    preview: previewSchema.nullable(),
    findings: z.array(findingSchema).max(FINDINGS_LIMIT),
    turnCount: z.number().int().nonnegative(),
    lastUpdatedAt: z.string().datetime(),
  })
  .strict();
export type CodeReviewState = z.infer<typeof codeReviewStateSchema>;

export function createInitialState(
  sandboxId = "code-review",
  selectedModel: ModelId = MODEL_IDS[5],
): CodeReviewState {
  return codeReviewStateSchema.parse({
    selectedModel,
    sandboxId,
    repository: {
      name: "order-service",
      source: FIXTURE_REPOSITORY_URL,
      workspace: WORKSPACE_ROOT,
      lifecycle: "not-cloned",
    },
    status: "idle",
    filesInspected: [],
    filesChanged: [],
    testRuns: [],
    diff: "",
    diffTruncated: false,
    preview: null,
    findings: [],
    turnCount: 0,
    lastUpdatedAt: new Date().toISOString(),
  });
}

function updated(state: CodeReviewState, patch: Partial<CodeReviewState>): CodeReviewState {
  return codeReviewStateSchema.parse({
    ...state,
    ...patch,
    lastUpdatedAt: new Date().toISOString(),
  });
}

function appendUniqueBounded(values: readonly string[], value: string, limit: number): string[] {
  return [...values.filter((existing) => existing !== value), value].slice(-limit);
}

export function setRepositoryLifecycle(
  state: CodeReviewState,
  lifecycle: RepositoryLifecycle,
): CodeReviewState {
  return updated(state, {
    repository: { ...state.repository, lifecycle: repositoryLifecycleSchema.parse(lifecycle) },
  });
}

export function setReviewStatus(state: CodeReviewState, status: ReviewStatus): CodeReviewState {
  return updated(state, { status: reviewStatusSchema.parse(status) });
}

export function recordFileInspected(state: CodeReviewState, path: string): CodeReviewState {
  const file = relativeFilePathSchema.parse(path);
  return updated(state, {
    filesInspected: appendUniqueBounded(state.filesInspected, file, INSPECTED_FILES_LIMIT),
  });
}

export function recordFileChanged(state: CodeReviewState, path: string): CodeReviewState {
  const file = relativeFilePathSchema.parse(path);
  return updated(state, {
    filesChanged: appendUniqueBounded(state.filesChanged, file, CHANGED_FILES_LIMIT),
  });
}

export function appendTestRun(state: CodeReviewState, input: TestRunInput): CodeReviewState {
  const createdAt = new Date().toISOString();
  const testRun = testRunSchema.parse({
    ...testRunInputSchema.parse(input),
    id: crypto.randomUUID(),
    createdAt,
  });
  return codeReviewStateSchema.parse({
    ...state,
    testRuns: [...state.testRuns, testRun].slice(-TEST_RUNS_LIMIT),
    lastUpdatedAt: createdAt,
  });
}

export function setDiff(state: CodeReviewState, diff: string, truncated = false): CodeReviewState {
  return updated(state, { diff, diffTruncated: truncated });
}

export function setPreview(state: CodeReviewState, preview: Preview | null): CodeReviewState {
  return updated(state, { preview: preview === null ? null : previewSchema.parse(preview) });
}

export function appendFinding(state: CodeReviewState, input: FindingInput): CodeReviewState {
  const createdAt = new Date().toISOString();
  const finding = findingSchema.parse({
    ...findingInputSchema.parse(input),
    id: crypto.randomUUID(),
    createdAt,
  });
  return codeReviewStateSchema.parse({
    ...state,
    findings: [...state.findings, finding].slice(-FINDINGS_LIMIT),
    lastUpdatedAt: createdAt,
  });
}
