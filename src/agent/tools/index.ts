import { tool } from "ai";
import { z } from "zod";

import {
  MAX_FILE_BYTES,
  type CommandResult,
  type DiffResult,
  type PreviewResult,
  type SandboxService,
} from "../../services/sandbox.js";
import {
  findingInputSchema,
  type FindingInput,
  type RepositoryLifecycle,
  type ReviewStatus,
  type TestRunInput,
} from "../state.js";

type MaybePromise<T> = T | Promise<T>;

export const cloneRepositoryInputSchema = z.object({}).strict();
export const listFilesInputSchema = z
  .object({ path: z.string().trim().min(1).max(300).default(".") })
  .strict();
export const readFileInputSchema = z.object({ path: z.string().trim().min(1).max(300) }).strict();
export const writeFileInputSchema = z
  .object({
    path: z.string().trim().min(1).max(300),
    content: z.string().max(MAX_FILE_BYTES),
  })
  .strict();
export const noInputSchema = z.object({}).strict();

export interface CodeReviewToolDependencies {
  service: SandboxService;
  setRepositoryLifecycle: (lifecycle: RepositoryLifecycle) => MaybePromise<void>;
  setStatus: (status: ReviewStatus) => MaybePromise<void>;
  recordFileInspected: (path: string) => MaybePromise<void>;
  recordFileChanged: (path: string) => MaybePromise<void>;
  recordTestRun: (run: TestRunInput) => MaybePromise<void>;
  setDiff: (diff: string, truncated: boolean) => MaybePromise<void>;
  setPreview: (preview: PreviewResult | null) => MaybePromise<void>;
  recordFinding: (finding: FindingInput) => MaybePromise<void>;
}

function testRunInput(result: CommandResult): TestRunInput {
  return {
    success: result.success,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    truncated: result.truncated,
  };
}

async function persistDiff(
  dependencies: CodeReviewToolDependencies,
  result: DiffResult,
): Promise<void> {
  await dependencies.setDiff(result.diff, result.truncated);
}

export function createCodeReviewTools(dependencies: CodeReviewToolDependencies) {
  return {
    cloneRepository: tool({
      description:
        "Clone the bundled order-service fixture into the fixed review workspace. No repository URL is accepted.",
      inputSchema: cloneRepositoryInputSchema,
      execute: async () => {
        await dependencies.setRepositoryLifecycle("cloning");
        const result = await dependencies.service.cloneRepository();
        await dependencies.setRepositoryLifecycle(result.ok ? "ready" : "error");
        if (result.ok) await dependencies.setStatus("reviewing");
        return result;
      },
    }),
    listFiles: tool({
      description:
        "List at most 200 non-hidden entries under a normalized path in the fixed review workspace.",
      inputSchema: listFilesInputSchema,
      execute: async ({ path }) => dependencies.service.listFiles(path),
    }),
    readFile: tool({
      description: "Read one UTF-8 file of at most 64 KiB from the fixed review workspace.",
      inputSchema: readFileInputSchema,
      execute: async ({ path }) => {
        const result = await dependencies.service.readFile(path);
        if (result.ok) await dependencies.recordFileInspected(result.data.path);
        return result;
      },
    }),
    writeFile: tool({
      description:
        "Write one UTF-8 file of at most 64 KiB inside the fixed review workspace. Use only after inspecting the file.",
      inputSchema: writeFileInputSchema,
      execute: async ({ path, content }) => {
        const result = await dependencies.service.writeFile(path, content);
        if (result.ok) {
          await dependencies.recordFileChanged(result.data.path);
          await dependencies.setStatus("fixing");
        }
        return result;
      },
    }),
    runTests: tool({
      description:
        "Run only the fixed dependency-free node --test command with a 30 second timeout and bounded output.",
      inputSchema: noInputSchema,
      execute: async () => {
        await dependencies.setStatus("testing");
        const result = await dependencies.service.runTests();
        if (result.ok) {
          await dependencies.recordTestRun(testRunInput(result.data));
          await dependencies.setStatus("reviewing");
        } else {
          await dependencies.setStatus("error");
        }
        return result;
      },
    }),
    getDiff: tool({
      description: "Return the bounded git diff for the fixed review workspace.",
      inputSchema: noInputSchema,
      execute: async () => {
        const result = await dependencies.service.getDiff();
        if (result.ok) await persistDiff(dependencies, result.data);
        return result;
      },
    }),
    startPreview: tool({
      description:
        "Start the fixed order-service process on 0.0.0.0:8080 and return its disposable tunnel URL.",
      inputSchema: noInputSchema,
      execute: async () => {
        const result = await dependencies.service.startPreview();
        if (result.ok) await dependencies.setPreview(result.data);
        return result;
      },
    }),
    recordFinding: tool({
      description: "Persist one concise code-review finding after the tests pass.",
      inputSchema: findingInputSchema,
      execute: async (input) => {
        await dependencies.recordFinding(input);
        return { ok: true as const, finding: input };
      },
    }),
    destroySandbox: tool({
      description: "Destroy the temporary review sandbox and all of its files and processes.",
      inputSchema: noInputSchema,
      execute: async () => {
        const result = await dependencies.service.destroySandbox();
        if (result.ok) {
          await dependencies.setPreview(null);
          await dependencies.setRepositoryLifecycle("destroyed");
          await dependencies.setStatus("idle");
        }
        return result;
      },
    }),
  };
}

export type CodeReviewTools = ReturnType<typeof createCodeReviewTools>;
