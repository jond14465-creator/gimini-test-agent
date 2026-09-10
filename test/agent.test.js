"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { runOsintAgent } = require("../src/agent");
const { parseArgs, parseServeArgs } = require("../src/index");
const { detectTargetType, normalizeTarget } = require("../src/guardrails");
const { formatTextReport } = require("../src/report");
const { createServer } = require("../src/server");

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

test("parseServeArgs lit le port et l'hôte", () => {
  const result = parseServeArgs(["--host", "0.0.0.0", "--port", "8080"]);
  assert.equal(result.host, "0.0.0.0");
  assert.equal(result.port, 8080);
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
        prefix: "https://rdap.org/domain/",
        payload: { ldhName: "example.com", entities: [{ handle: "EXAMPLE-1" }] },
      },
      {
        prefix: "https://crt.sh/",
        payload: [{ id: 1, common_name: "example.com", entry_timestamp: "2026-01-01" }],
      },
      {
        prefix: "https://web.archive.org/cdx/search/cdx",
        payload: [["timestamp", "original", "statuscode"], ["20240101000000", "http://example.com", "200"]],
      },
      {
        prefix: "https://api.github.com/search/repositories",
        payload: { items: [{ full_name: "example/example", description: "demo", html_url: "https://github.com/example/example" }] },
      },
      {
        prefix: "https://api.github.com/search/users",
        payload: { items: [] },
      },
      {
        prefix: "https://fr.wikipedia.org/",
        payload: { query: { search: [{ title: "Example", snippet: "Entrée de test" }] } },
      },
      {
        prefix: "https://hn.algolia.com/api/v1/search",
        payload: { hits: [{ title: "Example discussion", url: "https://news.ycombinator.com/item?id=1" }] },
      },
      {
        prefix: "https://registry.npmjs.org/-/v1/search",
        payload: { objects: [] },
      },
    ]),
    limit: 2,
  });

  assert.equal(report.type, "domain");
  assert.equal(report.summary.activeSources, 7);
  assert.equal(report.summary.totalFindings, 7);
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
      { prefix: "https://rdap.org/domain/", payload: { ldhName: "example.com", entities: [] } },
      { prefix: "https://crt.sh/", payload: { message: "unexpected" } },
      { prefix: "https://web.archive.org/cdx/search/cdx", payload: [] },
      { prefix: "https://api.github.com/search/repositories", payload: { items: [] } },
      { prefix: "https://api.github.com/search/users", payload: { items: [] } },
      { prefix: "https://fr.wikipedia.org/", payload: { query: { search: [] } } },
      { prefix: "https://hn.algolia.com/api/v1/search", payload: { hits: [] } },
      { prefix: "https://registry.npmjs.org/-/v1/search", payload: { objects: [] } },
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
      { prefix: "https://api.github.com/search/users", payload: { items: [] } },
      { prefix: "https://fr.wikipedia.org/", payload: { query: { search: [{ title: "Example" }] } } },
      { prefix: "https://hn.algolia.com/api/v1/search", payload: { hits: [] } },
      { prefix: "https://registry.npmjs.org/-/v1/search", payload: { objects: [] } },
    ]),
  });

  const wikipedia = report.sources.find((source) => source.source === "Wikipedia");
  assert.equal(wikipedia.findings[0].snippet, "Aucun extrait disponible.");
});

test("runOsintAgent tolère des payloads fournisseurs malformés", async () => {
  const report = await runOsintAgent("https://example.com/path", {
    fetchImpl: buildFetchStub([
      { prefix: "https://dns.google/resolve?name=example.com&type=A", payload: { Answer: {} } },
      { prefix: "https://rdap.org/domain/example.com", payload: { ldhName: "example.com", entities: {} } },
      { prefix: "https://crt.sh/?q=example.com&output=json", payload: [{ id: 7, name_value: "example.com", entry_timestamp: "2026-02-02" }] },
      { prefix: "https://web.archive.org/cdx/search/cdx?url=example.com/*", payload: {} },
      { prefix: "https://api.github.com/search/repositories", payload: { items: {} } },
      { prefix: "https://api.github.com/search/users", payload: { items: {} } },
      { prefix: "https://fr.wikipedia.org/", payload: { query: { search: {} } } },
      { prefix: "https://hn.algolia.com/api/v1/search", payload: { hits: {} } },
      { prefix: "https://registry.npmjs.org/-/v1/search", payload: { objects: {} } },
    ]),
  });

  const crtsh = report.sources.find((source) => source.source === "crt.sh");
  const dns = report.sources.find((source) => source.source === "Google DNS");

  assert.equal(report.type, "domain");
  assert.deepEqual(dns.findings, []);
  assert.equal(crtsh.findings[0].title, "example.com");
});

test("runOsintAgent peut exploiter GitHub Users et npm pour un pseudo", async () => {
  const report = await runOsintAgent("octocat", {
    type: "username",
    fetchImpl: buildFetchStub([
      { prefix: "https://api.github.com/search/repositories", payload: { items: [] } },
      { prefix: "https://api.github.com/search/users", payload: { items: [{ login: "octocat", type: "User", html_url: "https://github.com/octocat" }] } },
      { prefix: "https://fr.wikipedia.org/", payload: { query: { search: [] } } },
      { prefix: "https://hn.algolia.com/api/v1/search", payload: { hits: [] } },
      {
        prefix: "https://registry.npmjs.org/-/v1/search",
        payload: { objects: [{ package: { name: "@octo/demo", description: "pkg", links: { npm: "https://www.npmjs.com/package/@octo/demo" } } }] },
      },
    ]),
  });

  const githubUsers = report.sources.find((source) => source.source === "GitHub Users");
  const npm = report.sources.find((source) => source.source === "npm");
  assert.equal(githubUsers.findings[0].title, "octocat");
  assert.equal(npm.findings[0].title, "@octo/demo");
});

function makeRequest(server, path) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: address.address,
        port: address.port,
        path,
        method: "GET",
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("createServer expose /health et /osint", async () => {
  const server = createServer({
    runAgent: async (target, options) => ({
      target,
      type: options.type || "keyword",
      summary: { activeSources: 1, totalFindings: 1, generatedAt: "2026-01-01T00:00:00.000Z" },
      sources: [{ source: "Stub", findings: [{ title: "ok", snippet: "demo", url: "https://example.com" }], error: null }],
      disclaimer: "public uniquement",
    }),
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const health = await makeRequest(server, "/health");
    assert.equal(health.statusCode, 200);
    assert.match(health.body, /"status":"ok"/);

    const osint = await makeRequest(server, "/osint?target=octocat&type=username&format=text");
    assert.equal(osint.statusCode, 200);
    assert.match(osint.headers["content-type"], /text\/plain/);
    assert.match(osint.body, /Cible: octocat/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
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
