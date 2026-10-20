"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { buildEvidence } = require("../src/evidence");
const { runOsintAgent } = require("../src/agent");
const { formatMarkdownReport } = require("../src/report");
const { saveReport } = require("../src/storage");
const { parseArgs } = require("../src/index");

const at = "2026-10-19T00:00:00.000Z";
function source(id, findings) {
  return { id, source: id, requestUrl: `https://example.com/${id}`, collectedAt: at, findings };
}
const finding = { title: "Example", snippet: "Public observation", url: "https://example.com/page" };

test("les doublons exacts conservent toutes les provenances sans prouver le contenu", () => {
  const evidence = buildEvidence([
    source("one", [finding, { ...finding, url: `${finding.url}?utm_source=test#fragment` }]),
    source("two", [finding]),
  ], "example", at);
  assert.equal(evidence.observations.length, 1);
  assert.equal(evidence.stats.duplicateFindings, 2);
  assert.equal(evidence.observations[0].provenance.length, 2);
  assert.equal(evidence.observations[0].verificationStatus, "unverified");
  assert.equal(evidence.timeline.length, 2);
  assert.ok(evidence.timeline.every(item => item.eventAt === null && item.collectedAt === at));
  assert.ok(evidence.graph.edges.every(edge => evidence.graph.nodes.some(node => node.id === edge.from) &&
    evidence.graph.nodes.some(node => node.id === edge.to)));
});

test("les variantes de contenu et paramètres significatifs restent distincts", () => {
  const evidence = buildEvidence([source("one", [finding,
    { ...finding, snippet: "Contradictory observation" },
    { ...finding, url: `${finding.url}?id=2` },
  ])], "example", at);
  assert.equal(evidence.observations.length, 3);
  const again = buildEvidence([source("one", [finding])], "example", at);
  assert.ok(evidence.observations.some(item => item.id === again.observations[0].id));
});

test("les preuves invalides ou URL actives sont rejetées", () => {
  const evidence = buildEvidence([source("one", [null,
    { ...finding, url: "javascript:alert(1)" },
    { ...finding, url: "https://user:password@example.com" },
    { ...finding, title: "" }, finding,
  ])], "example", at);
  assert.equal(evidence.stats.rejectedFindings, 4);
  assert.equal(evidence.stats.uniqueObservations, 1);
});

test("le moteur conserve le rapport historique et ajoute preuves et journal", async () => {
  const report = await runOsintAgent("example", {
    type: "keyword",
    fetchImpl: async url => ({ ok: true, json: async () => url.includes("search/repositories") ? {
      items: [{ full_name: finding.title, description: finding.snippet, html_url: finding.url }],
    } : {} }),
  });
  assert.equal(report.schemaVersion, "1.1");
  assert.equal(report.summary.totalFindings, 1);
  assert.equal(report.summary.uniqueObservations, 1);
  assert.equal(report.run.status, "completed");
  assert.equal(report.journal[0].action, "run_started");
  assert.equal(report.journal.at(-1).action, "run_finished");
  assert.ok(report.sources.every(item => item.requestUrl && item.collectedAt));
});

test("une collecte échouée produit une exécution partielle", async () => {
  const report = await runOsintAgent("example", { fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(report.run.status, "partial");
  assert.equal(report.observations.length, 0);
  assert.ok(report.sources.every(item => item.status === "failed"));
});

test("sauvegarde locale complète et contenu web échappé dans le Markdown", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osint-test-"));
  try {
    const report = await runOsintAgent("example", {
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    });
    report.observations = [{ ...finding, title: '<script>alert(1)</script> [link](https://evil.test)',
      contentHash: "hash", provenance: [] }];
    const markdown = formatMarkdownReport(report);
    assert.ok(!markdown.includes("<script>"));
    assert.ok(!markdown.includes("[link]("));
    const destination = await saveReport(report, root);
    assert.deepEqual((await fs.readdir(destination)).sort(), ["graph.json", "journal.jsonl", "report.json", "report.md"]);
    assert.equal(JSON.parse(await fs.readFile(path.join(destination, "report.json"), "utf8")).run.id, report.run.id);
    const journal = (await fs.readFile(path.join(destination, "journal.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(journal.at(-1).action, "run_finished");
    await assert.rejects(() => saveReport(report, root));
    assert.ok(!(await fs.readdir(root)).some(name => name.startsWith(".pending-")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("la CLI accepte une destination explicite et rejette une destination manquante", () => {
  assert.equal(parseArgs(["--output", "reports", "example.com"]).options.outputDir, "reports");
  assert.throws(() => parseArgs(["--output"]), /répertoire/);
});
