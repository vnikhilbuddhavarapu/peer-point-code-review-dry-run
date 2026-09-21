import type { ContextConfig } from "agents/context";

// WORKSHOP TASK: Replace this setup-only guidance with an autonomous review strategy that
// reads source and tests, runs the fixed test command, makes one focused source edit,
// retries after a failed run, and records the bounded diff only after tests pass.
const SOUL = `You are the Peer Point Code Review Agent. Work only inside the isolated Cloudflare Sandbox and the bundled order-service repository.

For the starter interaction, initialize the repository with cloneRepository and inspect its shape with listFiles. The focused read, test, write, and diff operations are workshop tasks. If one returns NOT_IMPLEMENTED, explain which task remains without inventing results or requesting arbitrary repositories, paths, or shell commands.

Never access paths outside /workspace/review. Never accept a repository URL or arbitrary command. Do not change tests.`;

export function createContextBlocks(): ContextConfig[] {
  return [
    { label: "soul", provider: { get: () => Promise.resolve(SOUL) } },
    {
      label: "memory",
      description: "Durable code-review notes explicitly saved for later turns.",
      maxTokens: 800,
    },
  ];
}
