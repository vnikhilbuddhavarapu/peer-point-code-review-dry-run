# Code Review Agent

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/vnikhilbuddhavarapu/peer-point-card-2-code-review)

Build an autonomous code-review loop with Cloudflare Think, Workers AI, Durable Objects, and Cloudflare Sandbox. The Agent works against a deterministic broken `order-service`, reproduces its failing test, applies the smallest source-only repair, reruns green, and records the resulting diff.

## What you will learn

- expose narrow Sandbox operations as typed Agent tools;
- keep model-directed file access and commands inside explicit safety boundaries;
- turn test output into an autonomous read-test-write-retry workflow;
- persist review progress while keeping tool output bounded.

## Already complete

The starter compiles and deploys before you edit it. It includes:

- the chat UI, model selection, Agent Durable Object, state, and safe structured logging;
- the pinned Sandbox SDK and matching `Dockerfile` image version;
- a deterministic repository fixture baked into the Sandbox image;
- lowercase Sandbox IDs, reset/destroy behavior, and a fixed workspace;
- fixed repository initialization plus `listFiles` as the complete example operation;
- typed tool wiring and a non-crashing `NOT_IMPLEMENTED` result for unfinished operations;
- an optional preview implementation that is not required for the base task.

No shared workshop service is required for this card. Workers AI and Sandbox run in your temporary lab account.

## Your two edit files

1. `src/services/sandbox.ts`
   - implement `readFile`, `writeFile`, `runTests`, and `getDiff` at the `WORKSHOP TASK` markers;
   - copy the error-handling style of `cloneRepository` and the path/bounding style of `listFiles`;
   - return typed expected failures instead of throwing.
2. `src/agent/context.ts`
   - replace the setup-only instructions with an autonomous review strategy;
   - require the Agent to inspect source and tests, reproduce the failure, make one focused source edit, rerun after failures, and read the diff only after tests pass.

Do not edit routing, bindings, generated types, state, UI, the fixture tests, or the Dockerfile for the base task.

## First successful run

Prerequisites are Node.js 24, npm 11, Wrangler authenticated to your temporary lab account, and Docker for local Sandbox development.

From the generated workshop repository root:

```bash
npm install
npm run dev --workspace @peer-point/code-review-starter
```

Open the displayed local URL and send:

> Initialize the bundled repository and list its files. Stop and explain if a review operation is not implemented.

Before you make changes, the Agent should clone only the bundled fixture, list the workspace, and explain that the focused repair operations are workshop tasks. `NOT_IMPLEMENTED` is expected starter behavior, not a crash.

If local Docker is unavailable or the first image build is too slow, deploy to the lab account and use the deployed Worker instead.

## Tool contracts

All expected operation failures use this discriminated result:

```ts
type SandboxResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: SandboxErrorCode; message: string } };
```

The Agent tools are deliberately narrow:

| Tool              | Input                                                     | Required result                                   |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------- |
| `cloneRepository` | no repository URL                                         | clone the baked-in fixture to `/workspace/review` |
| `listFiles`       | optional normalized workspace path                        | at most 200 non-hidden entries                    |
| `readFile`        | one normalized path                                       | one UTF-8 file no larger than 64 KiB              |
| `writeFile`       | one normalized path and bounded content                   | one workspace-only write no larger than 64 KiB    |
| `runTests`        | no command input                                          | only `node --test`, with a 30-second timeout      |
| `getDiff`         | no command input                                          | only the bounded repository diff                  |
| `recordFinding`   | validated title, severity, summary, and optional location | one persisted finding after tests pass            |
| `destroySandbox`  | no input                                                  | explicit sandbox cleanup                          |

`startPreview` is provided as an optional stretch operation and is not active in the base autonomous tool set.

## Base checklist

- [ ] `readFile` normalizes the path before reading and rejects files over `MAX_FILE_BYTES`.
- [ ] `writeFile` normalizes the path and bounds UTF-8 bytes before writing.
- [ ] `runTests` executes only `TEST_COMMAND` in `WORKSPACE_ROOT` with `TEST_TIMEOUT_MS`.
- [ ] test stdout and stderr share the `MAX_OUTPUT_BYTES` cap.
- [ ] timeouts return `TEST_TIMEOUT`; expected command failures remain typed data.
- [ ] `getDiff` executes only the fixed diff command and bounds its output.
- [ ] the context drives clone, inspect, failing test, diagnosis, focused source edit, retry, passing test, diff, and finding without step-by-step prompting.
- [ ] the Agent never edits a test to make the run pass.
- [ ] `npm test`, `npm run typecheck`, and `npm run build` pass.

## Stretch

After the base loop is reliable, you may expose the already bounded preview operation after a passing test. The service must stay on port `8080` and bind `0.0.0.0`. Preview availability depends on the lab environment; a missing preview URL must not fail the base task, deployment, or demo.

## Safety boundaries: do not remove

- The repository source is fixed at `file:///opt/fixtures/order-service`; never accept an arbitrary URL.
- Every path must normalize under `/workspace/review`; reject traversal, absolute external paths, backslashes, NUL bytes, and oversized paths.
- Keep Sandbox IDs lowercase and limited to letters, digits, and internal hyphens.
- Do not add a generic shell or command tool. Tests and diff use fixed commands only.
- Keep the 30-second command timeout, 64 KiB file limit, 32 KiB output limit, and 200-entry listing limit.
- Do not change fixture tests in the expected repair path.
- Keep preview on port `8080`, bound to `0.0.0.0`; do not use port `3000`.
- Keep `@cloudflare/sandbox` and the Docker base image on the same pinned release.
- Preserve explicit reset/destroy behavior and safe errors that do not expose credentials, prompts, or private endpoints.

## Verify, deploy, and demo

Run from this card directory:

```bash
npm test
npm run typecheck
npm run build
npm run deploy:dry-run
npm run check:startup
npm run deploy
```

For the base demo, ask:

> Review the bundled order-service autonomously. Inspect source and tests, reproduce the failure, make the smallest source-only fix, rerun until green, show the diff, and record one concise finding. Do not start a preview.

A successful demo shows at least one failing test followed by a passing test, one changed source file, a bounded diff, and one grounded finding.

## Recovery

- **`NOT_IMPLEMENTED`**: finish the matching `WORKSHOP TASK` in `src/services/sandbox.ts`; do not replace the typed result with a thrown error.
- **Docker or container startup fails**: confirm Docker is running, then retry once; otherwise use the deployed lab path.
- **Path rejected**: pass a repository-relative POSIX path such as `src/order.js`.
- **Tests time out**: confirm the implementation still runs only `node --test` with the fixed timeout and working directory.
- **Generated types differ**: run `npm run types`, inspect the binding change, and do not hand-edit `worker-configuration.d.ts`.
- **Stale workspace**: use **Reset sandbox** before retrying; reset destroys the previous sandbox.
- **Preview unavailable**: skip it. Preview is stretch behavior and does not block completion.

## Start with Peer Point OS

After the Deploy to Cloudflare flow creates your repository and first deployment, give the generated Git URL to Peer Point OS with this prompt:

```text
Clone this repository in an isolated Container MCP environment. Read the complete README before editing. Run npm ci and npm run verify to establish a baseline. Implement a working Code Review Agent using the required Cloudflare primitives and preserving its safety constraints. You may choose a different architecture from the suggested path. Run focused tests and npm run verify, inspect the diff, then push through the GitHub gatekeeper. Do not claim success until verification passes. After the push, inspect Workers Builds and give me the deployed URL and demo checklist.
```

## Start with your own IDE

```bash
npm ci
npm run verify
npm run dev
```

Before pushing or deploying:

```bash
npm run verify
```

Deploy only to the temporary lab account assigned for the event.
