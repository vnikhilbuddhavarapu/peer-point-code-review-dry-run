import type { UIMessage } from "ai";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToolCallCard } from "@peer-point/workshop-ui";

import { toDisplayMessages } from "../src/client/lib/messages.js";

describe("Code Review message UI", () => {
  it("strips complete and split think blocks without dropping visible text", () => {
    const messages: UIMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Prefix <THINK>private reasoning" },
          { type: "text", text: "continues</think> Grounded answer" },
          { type: "text", text: "</think>Final sentence" },
          { type: "reasoning", text: "also hidden", state: "done" },
        ],
      },
    ];

    expect(toDisplayMessages(messages)).toEqual([
      {
        id: "message-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Prefix" },
          { type: "text", text: "Grounded answer" },
          { type: "text", text: "Final sentence" },
        ],
      },
    ]);
  });

  it("drops messages containing only leaked reasoning", () => {
    const messages: UIMessage[] = [
      {
        id: "message-2",
        role: "assistant",
        parts: [{ type: "text", text: "<think>private chain of thought</think>" }],
      },
    ];

    expect(toDisplayMessages(messages)).toEqual([]);
  });

  it("projects code-review tool details into the shared expandable disclosure UI", () => {
    const messages: UIMessage[] = [
      {
        id: "message-3",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "runCommand",
            toolCallId: "tool-1",
            state: "output-available",
            input: { command: "npm test", timeoutMs: 30_000 },
            output: { exitCode: 0, stdout: "12 tests passed" },
          },
        ],
      },
    ];

    const toolPart = toDisplayMessages(messages)[0]?.parts[0];
    expect(toolPart).toEqual({
      type: "tool",
      toolName: "runCommand",
      state: "output",
      summary: "Tool completed",
      input: { command: "npm test", timeoutMs: 30_000 },
      output: { exitCode: 0, stdout: "12 tests passed" },
    });
    if (!toolPart || toolPart.type !== "tool") throw new Error("Expected a projected tool part");

    const html = renderToStaticMarkup(<ToolCallCard part={toolPart} />);
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Input");
    expect(html).toContain("Result");
    expect(html).toContain("12 tests passed");
  });

  it("keeps user text visible", () => {
    const messages: UIMessage[] = [
      { id: "message-4", role: "user", parts: [{ type: "text", text: "Review this patch" }] },
    ];

    expect(toDisplayMessages(messages)[0]?.parts).toEqual([
      { type: "text", text: "Review this patch" },
    ]);
  });
});
