import { MODEL_DEFINITIONS, MODEL_IDS, type ModelId } from "@peer-point/workshop-config";
import { WorkshopShell, type ConnectionStatus } from "@peer-point/workshop-ui";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import { useEffect, useMemo, useState } from "react";

import type { CodeReviewAgent } from "../agent/agent.js";
import { createInitialState, type CodeReviewState } from "../agent/state.js";
import { ReviewDashboard } from "./components/review-dashboard.js";
import { toDisplayMessages } from "./lib/messages.js";

function connectionStatus(
  readyState: number,
  chatStatus: string,
  hasError: boolean,
): ConnectionStatus {
  if (hasError || chatStatus === "error") return "error";
  if (chatStatus === "submitted") return "thinking";
  if (chatStatus === "streaming") return "streaming";
  if (readyState !== WebSocket.OPEN) return "connecting";
  return "ready";
}

export function App() {
  const [dashboard, setDashboard] = useState<CodeReviewState>(createInitialState());
  const [selectedModel, setSelectedModel] = useState<ModelId>(MODEL_IDS[5]);
  const [input, setInput] = useState("");
  const [actionError, setActionError] = useState<string>();

  const agent = useAgent<CodeReviewAgent, CodeReviewState>({
    agent: "CodeReviewAgent",
    name: "review",
    onStateUpdate: setDashboard,
    onStateUpdateError: () => setActionError("The Agent rejected a state update."),
  });
  const chat = useAgentChat({
    agent,
    body: () => ({ modelId: selectedModel, sandboxId: "code-review" }),
    syncMessagesToServer: false,
  });

  useEffect(() => setSelectedModel(dashboard.selectedModel), [dashboard.selectedModel]);

  const messages = useMemo(() => toDisplayMessages(chat.messages), [chat.messages]);
  const status = connectionStatus(
    agent.readyState,
    chat.status,
    Boolean(agent.connectionError ?? chat.error ?? actionError),
  );
  const error = actionError ?? chat.error?.message ?? agent.connectionError?.message;

  function submit(): void {
    const text = input.trim();
    if (!text) return;
    setActionError(undefined);
    void chat.sendMessage({ text }).catch(() => setActionError("The message could not be sent."));
    setInput("");
  }

  function changeModel(modelId: ModelId): void {
    setSelectedModel(modelId);
    void agent.stub.selectModel(modelId).catch(() => setActionError("Model selection failed."));
  }

  function reset(): void {
    chat.clearHistory();
    void agent.stub.resetReview().catch(() => setActionError("Review reset failed."));
  }

  return (
    <WorkshopShell
      aside={<ReviewDashboard state={dashboard} />}
      description="Watch an Agent inspect a deterministic repository in Cloudflare Sandbox, reproduce one failing test, make a focused patch, and rerun green."
      {...(error === undefined ? {} : { error })}
      input={input}
      inputPlaceholder="Review the order service, reproduce the failure, apply the smallest fix, and rerun tests…"
      messages={messages}
      models={MODEL_DEFINITIONS}
      onInputChange={setInput}
      onModelChange={changeModel}
      onReset={reset}
      onStop={() => void chat.stop()}
      onSubmit={submit}
      resetLabel="Reset sandbox"
      selectedModel={selectedModel}
      status={status}
      title="Code Review Agent"
    />
  );
}
