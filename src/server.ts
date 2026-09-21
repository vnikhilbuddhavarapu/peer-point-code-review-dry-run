import { getSandbox } from "@cloudflare/sandbox";
import { getAgentByName, routeAgentRequest } from "agents";

import { CodeReviewAgent } from "./agent/agent.js";
import { PREVIEW_PORT, sandboxIdSchema } from "./shared/review-contracts.js";
import { isLocalRequest, json } from "./shared/http.js";
import { parseSmokeRequest } from "./shared/smoke.js";

export { Sandbox } from "@cloudflare/sandbox";
export { CodeReviewAgent };

export default {
  async fetch(request, env): Promise<Response> {
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, service: "code-review", environment: env.ENVIRONMENT });
    }

    const previewMatch = url.pathname.match(/^\/preview\/([a-z0-9-]{1,63})(\/.*)?$/);
    if (previewMatch) {
      const sandboxId = sandboxIdSchema.parse(previewMatch[1]);
      const sandbox = getSandbox(env.Sandbox, sandboxId, {
        normalizeId: true,
        sleepAfter: "10m",
        transport: "rpc",
      });
      const targetPath = previewMatch[2] ?? "/";
      return sandbox.containerFetch(
        new URL(targetPath + url.search, "http://sandbox"),
        PREVIEW_PORT,
      );
    }

    if (request.method === "POST" && url.pathname === "/api/smoke" && isLocalRequest(request)) {
      try {
        const { input } = await parseSmokeRequest(request);
        const name = `acceptance-${crypto.randomUUID()}`;
        const agent = await getAgentByName(env.CODE_REVIEW_AGENT, name);
        await Promise.resolve(agent.prepareSmoke(name));
        const result = await Promise.resolve(agent.runSmokeTurn(input));
        const state = await Promise.resolve(agent.getDashboardState());
        return json({ result, state });
      } catch {
        return json(
          { ok: false, error: { code: "SMOKE_REJECTED", message: "Smoke request rejected" } },
          400,
        );
      }
    }

    return json({ ok: false, error: { code: "NOT_FOUND", message: "Route not found" } }, 404);
  },
} satisfies ExportedHandler<Env>;
