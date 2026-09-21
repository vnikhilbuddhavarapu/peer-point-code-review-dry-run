import { modelIdSchema, type ModelId } from "@peer-point/workshop-config";
import {
  Think,
  type ChatResponseResult,
  type StepContext,
  type ToolCallContext,
  type ToolCallResultContext,
  type TurnConfig,
  type TurnContext,
  type TurnResult,
} from "@cloudflare/think";
import { callable } from "agents";
import type { ContextConfig } from "agents/context";
import type { LanguageModel } from "ai";

import { createContextBlocks } from "./context.js";
import { createCodeReviewModel } from "./model.js";
import {
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
  type CodeReviewState,
  type FindingInput,
  type RepositoryLifecycle,
  type ReviewStatus,
  type TestRunInput,
} from "./state.js";
import { createCodeReviewTools, type CodeReviewTools } from "./tools/index.js";
import { createSandboxService, sandboxIdSchema, type PreviewResult } from "../services/sandbox.js";
import { logError, logInfo } from "../shared/logger.js";

const ACTIVE_TOOLS = [
  "cloneRepository",
  "listFiles",
  "readFile",
  "runTests",
  "writeFile",
  "getDiff",
  "recordFinding",
  "set_context",
];

export class CodeReviewAgent extends Think<Env, CodeReviewState> {
  override initialState = createInitialState();
  override maxSteps = 10;
  override includeMcpTools = false;
  override workspaceBash = false;
  override sendReasoning = false;
  override storeMessages = false;
  override storeTools = false;

  override getModel(): LanguageModel {
    return createCodeReviewModel(this.env, this.state.selectedModel);
  }

  override configureContext(): ContextConfig[] {
    return createContextBlocks();
  }

  override getTools(): CodeReviewTools {
    const currentService = () => createSandboxService(this.env, this.state.sandboxId);
    return createCodeReviewTools({
      service: {
        get sandboxId() {
          return currentService().sandboxId;
        },
        cloneRepository: () => currentService().cloneRepository(),
        listFiles: (path) => currentService().listFiles(path),
        readFile: (path) => currentService().readFile(path),
        writeFile: (path, content) => currentService().writeFile(path, content),
        runTests: () => currentService().runTests(),
        getDiff: () => currentService().getDiff(),
        startPreview: () => currentService().startPreview(),
        destroySandbox: () => currentService().destroySandbox(),
      },
      setRepositoryLifecycle: (lifecycle) => this.updateRepositoryLifecycle(lifecycle),
      setStatus: (status) => this.updateStatus(status),
      recordFileInspected: (path) => this.setState(recordFileInspected(this.state, path)),
      recordFileChanged: (path) => this.setState(recordFileChanged(this.state, path)),
      recordTestRun: (run) => this.recordTestRun(run),
      setDiff: (diff, truncated) => this.setState(setDiff(this.state, diff, truncated)),
      setPreview: (preview) => this.setState(setPreview(this.state, preview)),
      recordFinding: (finding) => this.recordFinding(finding),
    });
  }

  override validateStateChange(nextState: CodeReviewState): void {
    codeReviewStateSchema.parse(nextState);
  }

  @callable()
  selectModel(modelId: ModelId): ModelId {
    const selectedModel = modelIdSchema.parse(modelId);
    this.setState(
      codeReviewStateSchema.parse({
        ...this.state,
        selectedModel,
        lastUpdatedAt: new Date().toISOString(),
      }),
    );
    return selectedModel;
  }

  @callable()
  async startPreview(): Promise<PreviewResult> {
    if (this.state.testRuns.at(-1)?.success !== true) {
      throw new Error("PREVIEW_REQUIRES_PASSING_TESTS");
    }
    const result = await createSandboxService(this.env, this.state.sandboxId).startPreview();
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    this.setState(setPreview(this.state, result.data));
    return result.data;
  }

  @callable()
  async resetReview(): Promise<CodeReviewState> {
    await createSandboxService(this.env, this.state.sandboxId).destroySandbox();
    const nextState = createInitialState(this.state.sandboxId, this.state.selectedModel);
    this.setState(nextState);
    return nextState;
  }

  getDashboardState(): CodeReviewState {
    return codeReviewStateSchema.parse(this.state);
  }

  async prepareSmoke(sandboxId: string): Promise<void> {
    const validatedId = sandboxIdSchema.parse(sandboxId);
    await createSandboxService(this.env, validatedId).destroySandbox();
    this.setState(createInitialState(validatedId, this.state.selectedModel));
  }

  async runSmokeTurn(input: string): Promise<TurnResult> {
    return this.runTurn({ mode: "wait", input });
  }

  override beforeTurn(ctx: TurnContext): TurnConfig {
    const selectedModel =
      ctx.body?.modelId === undefined
        ? this.state.selectedModel
        : modelIdSchema.parse(ctx.body.modelId);
    const sandboxId =
      ctx.body?.sandboxId === undefined
        ? this.state.sandboxId
        : sandboxIdSchema.parse(ctx.body.sandboxId);
    this.setState(
      codeReviewStateSchema.parse({
        ...setReviewStatus(this.state, "reviewing"),
        selectedModel,
        sandboxId,
      }),
    );
    logInfo({
      event: "agent_turn",
      operation: "before-turn",
      outcome: "success",
      modelId: selectedModel,
    });
    return {
      model: createCodeReviewModel(this.env, selectedModel),
      activeTools: ACTIVE_TOOLS,
      maxOutputTokens: 650,
      maxSteps: this.maxSteps,
      sendReasoning: false,
    };
  }

  override beforeToolCall(ctx: ToolCallContext<CodeReviewTools>): void {
    logInfo({ event: "agent_tool", operation: "before-tool", toolName: ctx.toolName });
  }

  override afterToolCall(ctx: ToolCallResultContext<CodeReviewTools>): void {
    logInfo({
      event: "agent_tool",
      operation: "after-tool",
      outcome: ctx.toolOutput.type === "tool-result" ? "success" : "failure",
      toolName: ctx.toolName,
      durationMs: Math.round(ctx.toolExecutionMs),
    });
  }

  override onStepFinish(ctx: StepContext<CodeReviewTools>): void {
    logInfo({
      event: "agent_step",
      operation: ctx.finishReason,
      outcome: "success",
      tokenCount: ctx.usage.totalTokens ?? 0,
    });
  }

  override onChatResponse(result: ChatResponseResult): void {
    const testsPassed = this.state.testRuns.at(-1)?.success === true;
    this.setState(
      codeReviewStateSchema.parse({
        ...setReviewStatus(this.state, testsPassed ? "complete" : "reviewing"),
        turnCount: this.state.turnCount + 1,
      }),
    );
    logInfo({
      event: "agent_turn",
      operation: "chat-response",
      outcome: result.status === "completed" && testsPassed ? "success" : "failure",
      modelId: this.state.selectedModel,
    });
  }

  override onChatError(error: unknown): unknown {
    this.setState(setReviewStatus(this.state, "error"));
    logError({
      event: "agent_turn",
      operation: "chat-error",
      outcome: "failure",
      errorCode: "CHAT_FAILED",
    });
    return error;
  }

  private updateRepositoryLifecycle(lifecycle: RepositoryLifecycle): void {
    this.setState(setRepositoryLifecycle(this.state, lifecycle));
  }

  private updateStatus(status: ReviewStatus): void {
    this.setState(setReviewStatus(this.state, status));
  }

  private recordTestRun(run: TestRunInput): void {
    this.setState(appendTestRun(this.state, run));
  }

  private recordFinding(finding: FindingInput): void {
    if (this.state.testRuns.at(-1)?.success !== true)
      throw new Error("FINDING_REQUIRES_PASSING_TESTS");
    this.setState(appendFinding(this.state, finding));
  }
}
