import { z } from "zod";

export const FIXTURE_REPOSITORY_URL = "file:///opt/fixtures/order-service";
export const WORKSPACE_ROOT = "/workspace/review";
export const PREVIEW_PORT = 8080;
export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_OUTPUT_BYTES = 32 * 1024;

export const sandboxIdSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Sandbox ID must contain only lowercase letters, digits, and internal hyphens",
  );
