"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runOsintAgent } = require("../src/agent");
const { parseArgs, formatTextReport } = require("../src/index");

function buildFetchStub(routes) {
  return async function fetchStub(url) {
    const route = routes.find((entry) => url.startsWith(entry.prefix));
    if (!route) {
      return { ok: false, status: 404, json: async () => ({}) };
    }

    return {
      ok: true,
      status: 200,
      json: async () => route.payload,
    };
  };
}

test("parseArgs lit les options principales", () => {
  const result = parseArgs(["--json", "--type", "domain", "--limit", "3", "example.com"]);
  assert.equal(result.target, "example.com");
  assert.equal(result.options.json, true);
  assert.equal(result.options.type, "domain");
  assert.equal(result.options.limit, 3);
});

test("runOsintAgent agrège les sources pour un domaine", async () => {
  const report = await runOsintAgent("example.com", {
    fetchImpl: buildFetchStub([
      {
        prefix: "https://dns.google/resolve",
        payload: { Answer: [{ name: "example.com.", data: "93.184.216.34", TTL: 60, type: 1 }] },
      },
      {
        prefix: "https://crt.sh/",
        payload: [{ id: 1, common_name: "example.com", entry_timestamp: "2026-01-01" }],
      },
      {
        prefix: "https://api.github.com/search/repositories",
        payload: { items: [{ full_name: "example/example", description: "demo", html_url: "https://github.com/example/example" }] },
      },
      {
        prefix: "https://fr.wikipedia.org/",
        payload: { query: { search: [{ title: "Example", snippet: "Entrée de test" }] } },
      },
      {
        prefix: "https://hn.algolia.com/api/v1/search",
        payload: { hits: [{ title: "Example discussion", url: "https://news.ycombinator.com/item?id=1" }] },
      },
    ]),
    limit: 2,
  });

  assert.equal(report.type, "domain");
  assert.equal(report.summary.activeSources, 5);
  assert.equal(report.summary.totalFindings, 5);
  assert.equal(report.sources[0].source, "Google DNS");
});

test("runOsintAgent bloque les requêtes sensibles évidentes", async () => {
  await assert.rejects(
    () => runOsintAgent("api key leaked", { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }),
    /termes interdits/
  );
});

test("formatTextReport produit un rendu lisible", () => {
  const output = formatTextReport({
    target: "example",
    type: "keyword",
    summary: { activeSources: 1, totalFindings: 1 },
    sources: [
      {
        source: "GitHub",
        findings: [
          {
            title: "example/example",
            snippet: "demo",
            url: "https://github.com/example/example",
          },
        ],
        error: null,
      },
    ],
    disclaimer: "public uniquement",
  });

  assert.match(output, /Cible: example/);
  assert.match(output, /## GitHub/);
  assert.match(output, /public uniquement/);
});
