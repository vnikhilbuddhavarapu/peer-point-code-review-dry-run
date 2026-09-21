import type { CodeReviewState } from "../../agent/state.js";

interface ReviewDashboardProps {
  state: CodeReviewState;
  canStartPreview?: boolean;
  previewBusy?: boolean;
  onStartPreview?: () => void;
}

type UnknownRecord = Record<string, unknown>;

type TestOutcome = "failed" | "passed" | "running" | "unknown";

const FILE_LIMIT = 12;
const FINDING_LIMIT = 8;
const TEST_RUN_LIMIT = 8;
const DIFF_LINE_LIMIT = 300;
const TEST_OUTPUT_LIMIT = 2_000;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function asItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstValue(record: UnknownRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function textValue(record: UnknownRecord, keys: readonly string[], fallback: string): string {
  const value = firstValue(record, keys);
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(record: UnknownRecord, keys: readonly string[]): number | undefined {
  const value = firstValue(record, keys);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function displayValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function displayLabel(value: string): string {
  return value.replaceAll(/[-_]/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function boundedText(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}\n… output truncated` : value;
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (["complete", "completed", "ready", "passed", "success"].includes(normalized)) {
    return "success";
  }
  if (["error", "failed", "failure"].includes(normalized)) return "error";
  if (["running", "cloning", "testing", "reviewing", "working"].includes(normalized)) {
    return "active";
  }
  return "neutral";
}

function filePath(item: unknown): string {
  if (typeof item === "string") return item;
  return textValue(asRecord(item), ["path", "file", "name"], "Unknown file");
}

function testOutcome(run: UnknownRecord): TestOutcome {
  const passed = firstValue(run, ["passed", "success", "ok"]);
  if (passed === true) return "passed";
  if (passed === false) return "failed";

  const exitCode = numberValue(run, ["exitCode", "code"]);
  if (exitCode !== undefined) return exitCode === 0 ? "passed" : "failed";

  const status = textValue(run, ["status", "outcome", "result"], "").toLowerCase();
  if (
    ["passed", "pass", "success", "successful", "green", "complete", "completed"].includes(status)
  ) {
    return "passed";
  }
  if (["failed", "fail", "failure", "error", "red"].includes(status)) return "failed";
  if (["running", "pending", "queued", "started"].includes(status)) return "running";
  return "unknown";
}

function safePreviewUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function RepositoryOverview({
  repository,
  status,
  turnCount,
  inspectedCount,
  changedCount,
  testCount,
  sandboxId,
}: {
  repository: unknown;
  status: string;
  turnCount: number;
  inspectedCount: number;
  changedCount: number;
  testCount: number;
  sandboxId: unknown;
}) {
  const model = asRecord(repository);
  const repositoryText =
    displayValue(repository) ??
    displayValue(firstValue(model, ["name", "fullName", "slug", "url", "cloneUrl", "source"])) ??
    "Waiting for repository";
  const details = [
    ["Remote", firstValue(model, ["url", "cloneUrl", "remote", "source"])],
    ["Revision", firstValue(model, ["ref", "branch", "commit", "sha"])],
    ["Repository", firstValue(model, ["lifecycle", "status"])],
    ["Sandbox", firstValue(model, ["sandboxId", "containerId", "id"]) ?? sandboxId],
    ["Workspace", firstValue(model, ["path", "directory", "workdir", "workspace"])],
  ] as const;
  const visibleDetails = details.flatMap(([label, value]) => {
    const displayed = displayValue(value);
    return displayed ? [{ label, value: displayed }] : [];
  });

  return (
    <section className="review-overview" aria-labelledby="review-overview-title">
      <header className="review-panel__header">
        <div>
          <p>Sandbox workspace</p>
          <h2 id="review-overview-title">Repository &amp; sandbox</h2>
        </div>
        <span className={`review-status review-status--${statusTone(status)}`}>
          {displayLabel(status)}
        </span>
      </header>
      <div className="review-repository">
        <span className="review-repository__mark" aria-hidden="true">
          &lt;/&gt;
        </span>
        <div>
          <span>Active repository</span>
          <strong title={repositoryText}>{repositoryText}</strong>
        </div>
      </div>
      {visibleDetails.length > 0 ? (
        <dl className="review-repository__details">
          {visibleDetails.map((detail) => (
            <div key={detail.label}>
              <dt>{detail.label}</dt>
              <dd title={detail.value}>{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <dl className="review-metrics">
        <div>
          <dt>Turns</dt>
          <dd>{turnCount}</dd>
        </div>
        <div>
          <dt>Inspected</dt>
          <dd>{inspectedCount}</dd>
        </div>
        <div>
          <dt>Changed</dt>
          <dd>{changedCount}</dd>
        </div>
        <div>
          <dt>Test runs</dt>
          <dd>{testCount}</dd>
        </div>
      </dl>
    </section>
  );
}

function TestHistory({ runs }: { runs: readonly unknown[] }) {
  const visibleRuns = runs.slice(-TEST_RUN_LIMIT);

  return (
    <section className="review-panel" aria-labelledby="review-tests-title">
      <header className="review-panel__header">
        <div>
          <p>Verification loop</p>
          <h2 id="review-tests-title">Test history</h2>
        </div>
        <span aria-label={`${runs.length} total test runs`}>{runs.length}</span>
      </header>
      {visibleRuns.length === 0 ? (
        <p className="review-empty">No tests run yet. Ask Think to reproduce the failure.</p>
      ) : (
        <ol className="review-tests" aria-label="Test runs from earliest to latest">
          {visibleRuns.map((item, index) => {
            const run = asRecord(item);
            const outcome = testOutcome(run);
            const command = textValue(run, ["command", "script", "name"], "Test command");
            const summary = textValue(run, ["summary", "message", "detail"], "");
            const outputParts = [
              displayValue(firstValue(run, ["output", "stdout", "logs"])),
              displayValue(run.stderr),
            ].filter((value): value is string => value !== undefined);
            const output = outputParts.join("\n");
            const exitCode = numberValue(run, ["exitCode", "code"]);
            const id = textValue(run, ["id"], `test-run-${String(index + 1)}`);

            return (
              <li className={`review-test review-test--${outcome}`} key={`${id}-${String(index)}`}>
                <span className="review-test__marker" aria-hidden="true" />
                <div className="review-test__body">
                  <div className="review-test__heading">
                    <code>{command}</code>
                    <span>{displayLabel(outcome)}</span>
                  </div>
                  {summary ? <p>{summary}</p> : null}
                  <div className="review-test__meta">
                    <span>Run {runs.length - visibleRuns.length + index + 1}</span>
                    {exitCode === undefined ? null : <span>Exit {exitCode}</span>}
                  </div>
                  {output ? (
                    <details className="review-test__output">
                      <summary>Test output</summary>
                      <pre>{boundedText(output, TEST_OUTPUT_LIMIT)}</pre>
                    </details>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function FileColumn({
  files,
  label,
  empty,
}: {
  files: readonly unknown[];
  label: string;
  empty: string;
}) {
  const visibleFiles = files.slice(-FILE_LIMIT);
  return (
    <div className="review-files__column">
      <h3>
        {label} <span>{files.length}</span>
      </h3>
      {visibleFiles.length === 0 ? (
        <p className="review-empty">{empty}</p>
      ) : (
        <ul aria-label={`${label} files`}>
          {visibleFiles.map((file, index) => {
            const path = filePath(file);
            return (
              <li key={`${path}-${String(index)}`} title={path}>
                <span aria-hidden="true">{label === "Changed" ? "±" : "·"}</span>
                <code>{path}</code>
              </li>
            );
          })}
        </ul>
      )}
      {files.length > visibleFiles.length ? (
        <p className="review-files__more">Showing latest {visibleFiles.length}</p>
      ) : null}
    </div>
  );
}

function FilesPanel({
  inspected,
  changed,
}: {
  inspected: readonly unknown[];
  changed: readonly unknown[];
}) {
  return (
    <section className="review-panel" aria-labelledby="review-files-title">
      <header className="review-panel__header">
        <div>
          <p>Working set</p>
          <h2 id="review-files-title">Files</h2>
        </div>
        <span>{inspected.length + changed.length}</span>
      </header>
      <div className="review-files">
        <FileColumn files={inspected} label="Inspected" empty="No files inspected yet." />
        <FileColumn files={changed} label="Changed" empty="No files changed yet." />
      </div>
    </section>
  );
}

function DiffPanel({ diff, sourceTruncated }: { diff: string; sourceTruncated: boolean }) {
  const lines = diff ? diff.split("\n") : [];
  const visibleLines = lines.slice(0, DIFF_LINE_LIMIT);
  const isTruncated = sourceTruncated || lines.length > visibleLines.length;

  return (
    <section className="review-panel review-diff-panel" aria-labelledby="review-diff-title">
      <header className="review-panel__header">
        <div>
          <p>Proposed patch</p>
          <h2 id="review-diff-title">Patch diff</h2>
        </div>
        <span aria-label={`${lines.length} diff lines`}>{lines.length}</span>
      </header>
      {visibleLines.length === 0 ? (
        <p className="review-empty">No patch recorded yet.</p>
      ) : (
        <div className="review-diff" role="region" aria-label="Patch diff content" tabIndex={0}>
          <ol>
            {visibleLines.map((line, index) => {
              const tone =
                line.startsWith("+") && !line.startsWith("+++")
                  ? "addition"
                  : line.startsWith("-") && !line.startsWith("---")
                    ? "deletion"
                    : line.startsWith("@@")
                      ? "hunk"
                      : line.startsWith("diff ") || line.startsWith("+++") || line.startsWith("---")
                        ? "header"
                        : "context";
              return (
                <li className={`review-diff__line review-diff__line--${tone}`} key={index}>
                  <span aria-hidden="true">{index + 1}</span>
                  <code>{line || " "}</code>
                </li>
              );
            })}
          </ol>
          {isTruncated ? (
            <p className="review-diff__truncated">
              {lines.length > visibleLines.length
                ? `Diff truncated after ${String(DIFF_LINE_LIMIT)} lines.`
                : "Diff output was truncated in the sandbox."}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PreviewPanel({
  previewUrl,
  canStart,
  busy,
  onStart,
}: {
  previewUrl: unknown;
  canStart: boolean;
  busy: boolean;
  onStart?: () => void;
}) {
  const url = safePreviewUrl(previewUrl);
  return (
    <section className="review-panel" aria-labelledby="review-preview-title">
      <header className="review-panel__header">
        <div>
          <p>Disposable tunnel</p>
          <h2 id="review-preview-title">Preview</h2>
        </div>
        <span>{url ? "Live" : "Offline"}</span>
      </header>
      {url ? (
        <a className="review-preview" href={url} target="_blank" rel="noreferrer">
          <span>
            <strong>Open application preview</strong>
            <code>{url}</code>
          </span>
          <span aria-hidden="true">↗</span>
        </a>
      ) : onStart ? (
        <div className="review-preview-action">
          <p className="review-empty">
            {canStart
              ? "Tests are green. Start a disposable preview outside the model turn."
              : "Preview becomes available after the tests pass."}
          </p>
          <button type="button" disabled={!canStart || busy} onClick={onStart}>
            {busy ? "Starting preview…" : "Start preview"}
          </button>
        </div>
      ) : (
        <p className="review-empty">No preview URL exposed.</p>
      )}
    </section>
  );
}

function FindingsPanel({ findings }: { findings: readonly unknown[] }) {
  const visibleFindings = findings.slice(0, FINDING_LIMIT);
  return (
    <section className="review-panel" aria-labelledby="review-findings-title">
      <header className="review-panel__header">
        <div>
          <p>Review notes</p>
          <h2 id="review-findings-title">Findings</h2>
        </div>
        <span>{findings.length}</span>
      </header>
      {visibleFindings.length === 0 ? (
        <p className="review-empty">No findings recorded yet.</p>
      ) : (
        <ol className="review-findings">
          {visibleFindings.map((item, index) => {
            const finding = asRecord(item);
            const severity = textValue(finding, ["severity", "priority"], "info").toLowerCase();
            const severityTone = ["critical", "high", "warning", "medium", "low", "info"].includes(
              severity,
            )
              ? severity
              : "info";
            const title = textValue(finding, ["title", "name", "message"], "Review finding");
            const detail = textValue(
              finding,
              ["summary", "detail", "description", "recommendation"],
              "",
            );
            const path = textValue(finding, ["file", "path", "filename"], "");
            const rawLine = firstValue(finding, ["line", "lineNumber"]);
            const line =
              typeof rawLine === "number" || typeof rawLine === "string" ? rawLine : undefined;
            const location = path ? `${path}${line === undefined ? "" : `:${line}`}` : "";
            const id = textValue(finding, ["id"], `finding-${String(index + 1)}`);

            return (
              <li
                className={`review-finding review-finding--${severityTone}`}
                key={`${id}-${String(index)}`}
              >
                <div className="review-finding__heading">
                  <h3>{title}</h3>
                  <span className={`review-severity review-severity--${severityTone}`}>
                    {displayLabel(severity)}
                  </span>
                </div>
                {location ? <code title={location}>{location}</code> : null}
                {detail ? <p>{detail}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
      {findings.length > visibleFindings.length ? (
        <p className="review-findings__more">Showing first {visibleFindings.length} findings</p>
      ) : null}
    </section>
  );
}

export function ReviewDashboard({
  state,
  canStartPreview = false,
  previewBusy = false,
  onStartPreview,
}: ReviewDashboardProps) {
  const model = asRecord(state);
  const repository = model.repository;
  const inspectedFiles = asItems(firstValue(model, ["inspectedFiles", "filesInspected"]));
  const changedFiles = asItems(firstValue(model, ["changedFiles", "filesChanged"]));
  const testRuns = asItems(model.testRuns);
  const findings = asItems(model.findings);
  const status = textValue(model, ["status"], "idle");
  const turnCount = numberValue(model, ["turnCount"]) ?? 0;
  const diff = typeof model.diff === "string" ? model.diff : "";
  const preview = firstValue(model, ["previewUrl", "preview"]);
  const previewUrl = displayValue(preview) ?? displayValue(asRecord(preview).url);

  return (
    <div className="review-dashboard">
      <RepositoryOverview
        repository={repository}
        status={status}
        turnCount={turnCount}
        inspectedCount={inspectedFiles.length}
        changedCount={changedFiles.length}
        testCount={testRuns.length}
        sandboxId={model.sandboxId}
      />
      <TestHistory runs={testRuns} />
      <FilesPanel inspected={inspectedFiles} changed={changedFiles} />
      <DiffPanel diff={diff} sourceTruncated={model.diffTruncated === true} />
      <PreviewPanel
        previewUrl={previewUrl}
        canStart={canStartPreview}
        busy={previewBusy}
        {...(onStartPreview === undefined ? {} : { onStart: onStartPreview })}
      />
      <FindingsPanel findings={findings} />
    </div>
  );
}
