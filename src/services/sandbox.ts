import { getSandbox } from "@cloudflare/sandbox";
import { z } from "zod";

import {
  FIXTURE_REPOSITORY_URL,
  MAX_FILE_BYTES,
  PREVIEW_PORT,
  sandboxIdSchema,
  WORKSPACE_ROOT,
} from "../shared/review-contracts.js";

export {
  FIXTURE_REPOSITORY_URL,
  MAX_FILE_BYTES,
  MAX_OUTPUT_BYTES,
  PREVIEW_PORT,
  sandboxIdSchema,
  WORKSPACE_ROOT,
} from "../shared/review-contracts.js";

export const TEST_COMMAND = "node --test";
export const PREVIEW_COMMAND = "node src/server.js";
export const TEST_TIMEOUT_MS = 30_000;
export const MAX_LISTED_FILES = 200;

export const sandboxErrorCodeSchema = z.enum([
  "INVALID_PATH",
  "FILE_TOO_LARGE",
  "COMMAND_FAILED",
  "TEST_TIMEOUT",
  "PREVIEW_FAILED",
  "SANDBOX_FAILURE",
  "NOT_IMPLEMENTED",
]);
export type SandboxErrorCode = z.infer<typeof sandboxErrorCodeSchema>;

export interface SandboxError {
  code: SandboxErrorCode;
  message: string;
}

export type SandboxResult<T> = { ok: true; data: T } | { ok: false; error: SandboxError };

export interface ListedFile {
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
}

export interface ListFilesResult {
  path: string;
  files: ListedFile[];
  truncated: boolean;
}

export interface ReadFileResult {
  path: string;
  content: string;
  bytes: number;
}

export interface WriteFileResult {
  path: string;
  bytes: number;
}

export interface CommandResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface DiffResult {
  diff: string;
  truncated: boolean;
}

export interface PreviewResult {
  url: string;
  port: typeof PREVIEW_PORT;
  processId: string;
}

export interface CloneResult {
  repository: "order-service";
  path: typeof WORKSPACE_ROOT;
  alreadyCloned: boolean;
}

export interface DestroyResult {
  destroyed: true;
}

interface SandboxFileEntry {
  absolutePath: string;
  relativePath: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
}

interface SandboxProcess {
  id: string;
  getStatus(): Promise<"starting" | "running" | "completed" | "failed" | "killed" | "error">;
  getLogs(): Promise<{ stdout: string; stderr: string }>;
}

export interface SandboxClient {
  exists(path: string): Promise<{ exists: boolean }>;
  gitCheckout(
    repositoryUrl: string,
    options: { targetDir: string; depth: number; cloneTimeoutMs: number },
  ): Promise<unknown>;
  listFiles(
    path: string,
    options: { recursive: boolean; includeHidden: boolean },
  ): Promise<{ files: SandboxFileEntry[] }>;
  readFile(
    path: string,
    options: { encoding: "utf-8" },
  ): Promise<{ content: string; size?: number }>;
  writeFile(path: string, content: string, options: { encoding: "utf-8" }): Promise<unknown>;
  exec(
    command: string,
    options: { cwd: string; timeout: number; env?: Record<string, string> },
  ): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }>;
  startProcess(
    command: string,
    options: {
      cwd: string;
      env: Record<string, string>;
      processId: string;
      autoCleanup: boolean;
    },
  ): Promise<SandboxProcess>;
  containerFetch(url: string, options: RequestInit, port?: number): Promise<Response>;
  destroy(): Promise<void>;
}

export interface SandboxService {
  readonly sandboxId: string;
  cloneRepository(): Promise<SandboxResult<CloneResult>>;
  listFiles(path?: string): Promise<SandboxResult<ListFilesResult>>;
  readFile(path: string): Promise<SandboxResult<ReadFileResult>>;
  writeFile(path: string, content: string): Promise<SandboxResult<WriteFileResult>>;
  runTests(): Promise<SandboxResult<CommandResult>>;
  getDiff(): Promise<SandboxResult<DiffResult>>;
  startPreview(): Promise<SandboxResult<PreviewResult>>;
  destroySandbox(): Promise<SandboxResult<DestroyResult>>;
}

function failure<T>(code: SandboxErrorCode, message: string): SandboxResult<T> {
  return { ok: false, error: { code, message } };
}

function workshopTask<T>(operation: string): SandboxResult<T> {
  return failure(
    "NOT_IMPLEMENTED",
    `${operation} is a WORKSHOP TASK. Implement the bounded Sandbox operation in src/services/sandbox.ts.`,
  );
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function normalizeWorkspacePath(
  untrustedPath: string,
  allowRoot = false,
): SandboxResult<string> {
  if (
    typeof untrustedPath !== "string" ||
    untrustedPath.length > 300 ||
    untrustedPath.includes("\0") ||
    untrustedPath.includes("\\")
  ) {
    return failure(
      "INVALID_PATH",
      "Path must be a valid POSIX workspace path of at most 300 characters",
    );
  }

  let relative = untrustedPath.trim();
  if (relative === WORKSPACE_ROOT) relative = "";
  else if (relative.startsWith(`${WORKSPACE_ROOT}/`)) {
    relative = relative.slice(WORKSPACE_ROOT.length + 1);
  } else if (relative.startsWith("/")) {
    return failure("INVALID_PATH", "Path must stay inside /workspace/review");
  }

  const parts: string[] = [];
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) {
        return failure("INVALID_PATH", "Path must stay inside /workspace/review");
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  if (parts.length === 0 && !allowRoot) {
    return failure("INVALID_PATH", "A file path inside /workspace/review is required");
  }
  return {
    ok: true,
    data: parts.length === 0 ? WORKSPACE_ROOT : `${WORKSPACE_ROOT}/${parts.join("/")}`,
  };
}

function relativeWorkspacePath(path: string): string {
  return path === WORKSPACE_ROOT ? "." : path.slice(WORKSPACE_ROOT.length + 1);
}

function sandboxFailure<T>(operation: string, error: unknown): SandboxResult<T> {
  const cause = error instanceof Error ? error.name : "UnknownError";
  return failure("SANDBOX_FAILURE", `${operation} failed (${cause})`);
}

export class CloudflareSandboxService implements SandboxService {
  readonly sandboxId: string;
  private preview: PreviewResult | undefined;

  constructor(
    sandboxId: string,
    private readonly sandbox: SandboxClient,
    private readonly publicBaseUrl = "https://peer-point-code-review.example.invalid",
    private readonly wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    this.sandboxId = sandboxIdSchema.parse(sandboxId);
    this.publicBaseUrl = new URL(publicBaseUrl).origin;
  }

  async cloneRepository(): Promise<SandboxResult<CloneResult>> {
    try {
      const existing = await this.sandbox.exists(WORKSPACE_ROOT);
      if (existing.exists) {
        return {
          ok: true,
          data: { repository: "order-service", path: WORKSPACE_ROOT, alreadyCloned: true },
        };
      }
      await this.sandbox.gitCheckout(FIXTURE_REPOSITORY_URL, {
        targetDir: WORKSPACE_ROOT,
        depth: 1,
        cloneTimeoutMs: TEST_TIMEOUT_MS,
      });
      return {
        ok: true,
        data: { repository: "order-service", path: WORKSPACE_ROOT, alreadyCloned: false },
      };
    } catch (error) {
      try {
        await this.sandbox.destroy();
      } catch (cleanupError) {
        return sandboxFailure("Repository clone and sandbox cleanup", cleanupError);
      }
      return sandboxFailure("Repository clone", error);
    }
  }

  async listFiles(path = "."): Promise<SandboxResult<ListFilesResult>> {
    const normalized = normalizeWorkspacePath(path, true);
    if (!normalized.ok) return normalized;

    try {
      const result = await this.sandbox.listFiles(normalized.data, {
        recursive: true,
        includeHidden: false,
      });
      const files = result.files
        .filter(
          (file) =>
            (file.absolutePath === WORKSPACE_ROOT ||
              file.absolutePath.startsWith(`${WORKSPACE_ROOT}/`)) &&
            !relativeWorkspacePath(file.absolutePath)
              .split("/")
              .some((part) => part.startsWith(".")),
        )
        .slice(0, MAX_LISTED_FILES)
        .map((file) => ({
          path: relativeWorkspacePath(file.absolutePath),
          type: file.type,
          size: file.size,
        }));
      return {
        ok: true,
        data: {
          path: relativeWorkspacePath(normalized.data),
          files,
          truncated: result.files.length > files.length,
        },
      };
    } catch (error) {
      return sandboxFailure("File listing", error);
    }
  }

  // WORKSHOP TASK: Read one normalized UTF-8 file and enforce MAX_FILE_BYTES before returning it.
  readFile(path: string): Promise<SandboxResult<ReadFileResult>> {
    const normalized = normalizeWorkspacePath(path);
    if (!normalized.ok) return Promise.resolve(normalized);
    return Promise.resolve(workshopTask<ReadFileResult>("readFile"));
  }

  // WORKSHOP TASK: Write only normalized workspace paths after enforcing MAX_FILE_BYTES.
  writeFile(path: string, content: string): Promise<SandboxResult<WriteFileResult>> {
    const normalized = normalizeWorkspacePath(path);
    if (!normalized.ok) return Promise.resolve(normalized);
    if (byteLength(content) > MAX_FILE_BYTES) {
      return Promise.resolve(
        failure("FILE_TOO_LARGE", `File exceeds the ${String(MAX_FILE_BYTES)} byte limit`),
      );
    }
    return Promise.resolve(workshopTask<WriteFileResult>("writeFile"));
  }

  // WORKSHOP TASK: Run only TEST_COMMAND in WORKSPACE_ROOT with TEST_TIMEOUT_MS and bounded output.
  runTests(): Promise<SandboxResult<CommandResult>> {
    return Promise.resolve(workshopTask<CommandResult>("runTests"));
  }

  // WORKSHOP TASK: Run only the fixed git diff command and bound its stdout to MAX_OUTPUT_BYTES.
  getDiff(): Promise<SandboxResult<DiffResult>> {
    return Promise.resolve(workshopTask<DiffResult>("getDiff"));
  }

  async startPreview(): Promise<SandboxResult<PreviewResult>> {
    if (this.preview) return { ok: true, data: this.preview };

    try {
      const process = await this.sandbox.startProcess(PREVIEW_COMMAND, {
        cwd: WORKSPACE_ROOT,
        env: { PORT: String(PREVIEW_PORT), HOST: "0.0.0.0" },
        processId: "peer-point-preview",
        autoCleanup: false,
      });
      await this.wait(2_000);
      const status = await process.getStatus();
      if (status !== "running") {
        const logs = await process.getLogs();
        const detail = (logs.stderr || logs.stdout || status).slice(0, 200);
        throw new Error(`Preview process ${status}: ${detail}`);
      }
      this.preview = {
        url: `${this.publicBaseUrl}/preview/${this.sandboxId}/`,
        port: PREVIEW_PORT,
        processId: process.id,
      };
      return { ok: true, data: this.preview };
    } catch (error) {
      const cause = error instanceof Error ? error.message : "Unknown error";
      return failure("PREVIEW_FAILED", `Preview startup failed: ${cause.slice(0, 120)}`);
    }
  }

  async destroySandbox(): Promise<SandboxResult<DestroyResult>> {
    try {
      await this.sandbox.destroy();
      this.preview = undefined;
      return { ok: true, data: { destroyed: true } };
    } catch (error) {
      return sandboxFailure("Sandbox destruction", error);
    }
  }
}

export function createSandboxService(
  env: Pick<Env, "Sandbox" | "PUBLIC_BASE_URL">,
  sandboxId: string,
): SandboxService {
  const validatedId = sandboxIdSchema.parse(sandboxId);
  const sandbox = getSandbox(env.Sandbox, validatedId, {
    enableDefaultSession: false,
    normalizeId: true,
    sleepAfter: "10m",
    transport: "rpc",
  });
  return new CloudflareSandboxService(validatedId, sandbox, env.PUBLIC_BASE_URL);
}
