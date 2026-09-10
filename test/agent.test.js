"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runOsintAgent } = require("../src/agent");
const { parseArgs, formatTextReport } = require("../src/index");
const { detectTargetType, normalizeTarget } = require("../src/guardrails");

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

test("parseArgs rejette les types inconnus", () => {
  assert.throws(() => parseArgs(["--type", "email", "alice"]), /domain, username ou keyword/);
});

test("parseArgs rejette une limite invalide", () => {
  assert.throws(() => parseArgs(["--limit", "0", "alice"]), /entier entre 1 et 10/);
});

test("detectTargetType traite les URL comme des domaines", () => {
  assert.equal(normalizeTarget("https://example.com/foo?bar=baz"), "example.com");
  assert.equal(detectTargetType("https://example.com/foo?bar=baz"), "domain");
});

test("detectTargetType peut garder un pseudo ambigu comme username", () => {
  assert.equal(detectTargetType("octocat.dev"), "username");
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

test("runOsintAgent tolère un payload crt.sh inattendu", async () => {
  const report = await runOsintAgent("example.com", {
    fetchImpl: buildFetchStub([
      { prefix: "https://dns.google/resolve", payload: { Answer: [] } },
      { prefix: "https://crt.sh/", payload: { message: "unexpected" } },
      { prefix: "https://api.github.com/search/repositories", payload: { items: [] } },
      { prefix: "https://fr.wikipedia.org/", payload: { query: { search: [] } } },
      { prefix: "https://hn.algolia.com/api/v1/search", payload: { hits: [] } },
    ]),
  });

  const crtsh = report.sources.find((source) => source.source === "crt.sh");
  assert.deepEqual(crtsh.findings, []);
  assert.equal(crtsh.error, null);
});

test("runOsintAgent tolère une entrée Wikipedia sans snippet", async () => {
  const report = await runOsintAgent("example", {
    type: "keyword",
    fetchImpl: buildFetchStub([
      { prefix: "https://api.github.com/search/repositories", payload: { items: [] } },
      { prefix: "https://fr.wikipedia.org/", payload: { query: { search: [{ title: "Example" }] } } },
      { prefix: "https://hn.algolia.com/api/v1/search", payload: { hits: [] } },
    ]),
  });

  const wikipedia = report.sources.find((source) => source.source === "Wikipedia");
  assert.equal(wikipedia.findings[0].snippet, "Aucun extrait disponible.");
});

test("runOsintAgent tolère des payloads fournisseurs malformés", async () => {
  const report = await runOsintAgent("https://example.com/path", {
    fetchImpl: buildFetchStub([
      { prefix: "https://dns.google/resolve?name=example.com&type=A", payload: { Answer: {} } },
      { prefix: "https://crt.sh/?q=example.com&output=json", payload: [{ id: 7, name_value: "example.com", entry_timestamp: "2026-02-02" }] },
      { prefix: "https://api.github.com/search/repositories", payload: { items: {} } },
      { prefix: "https://fr.wikipedia.org/", payload: { query: { search: {} } } },
      { prefix: "https://hn.algolia.com/api/v1/search", payload: { hits: {} } },
    ]),
  });

  const crtsh = report.sources.find((source) => source.source === "crt.sh");
  const dns = report.sources.find((source) => source.source === "Google DNS");

  assert.equal(report.type, "domain");
  assert.deepEqual(dns.findings, []);
  assert.equal(crtsh.findings[0].title, "example.com");
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
