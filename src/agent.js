"use strict";

const { assertAllowedTarget, detectTargetType, normalizeTarget } = require("./guardrails");
const { buildProviders } = require("./providers");
const { validateOptions } = require("./options");
const { randomUUID } = require("node:crypto");
const { buildEvidence } = require("./evidence");

async function fetchJson(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Délai de collecte dépassé."));
      controller.abort();
    }, timeoutMs);
  });
  try {
    const request = async () => {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          "user-agent": "gimini-test-agent/1.0",
          accept: "application/json",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    };
    return await Promise.race([timeout, request()]);
  } finally {
    clearTimeout(timer);
  }
}

function summarize(resultsBySource) {
  const totalFindings = resultsBySource.reduce(
    (sum, source) => sum + source.findings.length,
    0
  );
  const activeSources = resultsBySource.filter((source) => source.findings.length > 0).length;

  return {
    activeSources,
    totalFindings,
    generatedAt: new Date().toISOString(),
  };
}

async function runOsintAgent(target, options = {}) {
  validateOptions(options);
  const normalizedTarget = assertAllowedTarget(target);
  const type = options.type || detectTargetType(normalizedTarget);
  const fetchImpl = options.fetchImpl || global.fetch;
  const providerTarget = type === "domain" ? normalizeTarget(normalizedTarget) : normalizedTarget;

  if (typeof fetchImpl !== "function") {
    throw new Error("Aucune implémentation fetch n'est disponible.");
  }

  const providers = buildProviders(providerTarget, type);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  const resultsBySource = await Promise.all(
    providers.map(async (provider) => {
      const metadata = { id: provider.id, requestUrl: provider.url };
      if (!provider.enabled) {
        return { ...metadata, source: provider.label, status: "disabled", collectedAt: null, findings: [], error: "Source désactivée." };
      }

      try {
        const payload = await fetchJson(provider.url, fetchImpl, options.timeoutMs ?? 10000);
        const findings = provider.parse(payload).slice(0, options.limit || 5);
        return { ...metadata, source: provider.label, status: "collected", collectedAt: new Date().toISOString(), findings, error: null };
      } catch (error) {
        return {
          ...metadata,
          source: provider.label,
          status: "failed",
          collectedAt: new Date().toISOString(),
          findings: [],
          error: `Collecte impossible: ${error.message}`,
        };
      }
    })
  );
  const completedAt = new Date().toISOString();
  const evidence = buildEvidence(resultsBySource, normalizedTarget, completedAt);

  return {
    schemaVersion: "1.1",
    run: { id: runId, startedAt, completedAt, status: resultsBySource.some(source => source.status === "failed") ? "partial" : "completed" },
    target: normalizedTarget,
    type,
    summary: { ...summarize(resultsBySource), ...evidence.stats },
    sources: resultsBySource,
    observations: evidence.observations,
    graph: evidence.graph,
    timeline: evidence.timeline,
    journal: [
      { runId, at: startedAt, action: "run_started" },
      ...resultsBySource.map(source => ({ runId, at: source.collectedAt || startedAt,
        action: "source_finished", sourceId: source.id, status: source.status, findingCount: source.findings.length })),
      { runId, at: completedAt, action: "run_finished", ...evidence.stats },
    ].sort((a, b) => a.at.localeCompare(b.at)),
    disclaimer:
      "Utilisation autorisée uniquement sur des informations publiques et dans un cadre légal.",
  };
}

module.exports = {
  runOsintAgent,
};
