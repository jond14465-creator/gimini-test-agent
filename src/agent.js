"use strict";

const { assertAllowedTarget, detectTargetType, normalizeTarget } = require("./guardrails");
const { buildProviders } = require("./providers");
const { validateOptions } = require("./options");

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
    return await Promise.race([timeout, (async () => {
        const response = await fetchImpl(url, {
          signal: controller.signal,
          headers: {
            "user-agent": "gimini-test-agent/1.0",
            accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    })()]);
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

  const resultsBySource = await Promise.all(
    providers.map(async (provider) => {
      if (!provider.enabled) {
        return { source: provider.label, findings: [], error: "Source désactivée." };
      }

      try {
        const payload = await fetchJson(provider.url, fetchImpl, options.timeoutMs ?? 10000);
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
