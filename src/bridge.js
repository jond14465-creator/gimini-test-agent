"use strict";

// One JSON input/output for the Python orchestrator; no shell interpolation.
const { runOsintAgent } = require("./agent");
const { buildEvidence } = require("./evidence");
const { saveReport } = require("./storage");
const { assertAllowedTarget } = require("./guardrails");
const { validateOptions } = require("./options");

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  let output;
  if (input.action === "validate") {
    validateOptions({ type: input.type });
    output = { target: assertAllowedTarget(input.target) };
  } else if (input.action === "collect") {
    output = await runOsintAgent(input.target, { type: input.type, limit: input.limit || 5 });
  } else if (input.action === "enrich") {
    const report = input.report;
    report.sources.push(...input.sources);
    const evidence = buildEvidence(report.sources, report.target, new Date().toISOString());
    Object.assign(report, { observations: evidence.observations, graph: evidence.graph, timeline: evidence.timeline });
    Object.assign(report.summary, evidence.stats, {
      activeSources: report.sources.filter(source => source.findings.length > 0).length,
      totalFindings: report.sources.reduce((sum, source) => sum + source.findings.length, 0),
    });
    report.run.status = report.sources.some(source => source.status === "failed") ? "partial" : "completed";
    output = report;
  } else if (input.action === "save") {
    output = { directory: await saveReport(input.report, input.outputDir) };
  } else {
    throw new Error("Action inconnue");
  }
  process.stdout.write(JSON.stringify(output));
}

main().catch(() => { process.stderr.write("Échec du pont de collecte Node.js\n"); process.exitCode = 1; });
