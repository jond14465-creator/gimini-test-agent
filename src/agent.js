"use strict";

const { assertAllowedTarget, detectTargetType } = require("./guardrails");
const { buildProviders } = require("./providers");

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": "gimini-test-agent-osint/1.0",
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
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
  const normalizedTarget = assertAllowedTarget(target);
  const type = options.type || detectTargetType(normalizedTarget);
  const fetchImpl = options.fetchImpl || global.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("Aucune implémentation fetch n'est disponible.");
  }

  const providers = buildProviders(normalizedTarget, type);

  const resultsBySource = await Promise.all(
    providers.map(async (provider) => {
      if (!provider.enabled) {
        return { source: provider.label, findings: [], error: "Source désactivée." };
      }

      try {
        const payload = await fetchJson(provider.url, fetchImpl);
        const findings = provider.parse(payload).slice(0, options.limit || 5);
        return { source: provider.label, findings, error: null };
      } catch (error) {
        return {
          source: provider.label,
          findings: [],
          error: `Collecte impossible: ${error.message}`,
        };
      }
    })
  );

  return {
    target: normalizedTarget,
    type,
    summary: summarize(resultsBySource),
    sources: resultsBySource,
    disclaimer:
      "Utilisation autorisée uniquement sur des informations publiques et dans un cadre légal.",
  };
}

module.exports = {
  runOsintAgent,
};
