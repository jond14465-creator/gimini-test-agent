#!/usr/bin/env node
"use strict";

const { runOsintAgent } = require("./agent");

function parseArgs(argv) {
  const values = [...argv];
  const options = { json: false, type: null, limit: 5 };
  const allowedTypes = new Set(["domain", "username", "keyword"]);

  while (values[0]?.startsWith("--")) {
    const option = values.shift();

    if (option === "--json") {
      options.json = true;
      continue;
    }

    if (option === "--type") {
      options.type = values.shift() || null;
      if (!allowedTypes.has(options.type)) {
        throw new Error("Le type doit être domain, username ou keyword.");
      }
      continue;
    }

    if (option === "--limit") {
      options.limit = Number(values.shift() || "5");
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10) {
        throw new Error("La limite doit être un entier entre 1 et 10.");
      }
      continue;
    }

    throw new Error(`Option inconnue: ${option}`);
  }

  return {
    target: values.join(" ").trim(),
    options,
  };
}

function formatTextReport(report) {
  const lines = [
    `Cible: ${report.target}`,
    `Type: ${report.type}`,
    `Sources utiles: ${report.summary.activeSources}/${report.sources.length}`,
    `Résultats: ${report.summary.totalFindings}`,
    "",
  ];

  for (const source of report.sources) {
    lines.push(`## ${source.source}`);
    if (source.error) {
      lines.push(`- ${source.error}`);
      lines.push("");
      continue;
    }

    if (source.findings.length === 0) {
      lines.push("- Aucun résultat");
      lines.push("");
      continue;
    }

    for (const finding of source.findings) {
      lines.push(`- ${finding.title}`);
      lines.push(`  ${finding.snippet}`);
      lines.push(`  ${finding.url}`);
    }
    lines.push("");
  }

  lines.push(report.disclaimer);
  return lines.join("\n");
}

async function main() {
  try {
    const { target, options } = parseArgs(process.argv.slice(2));

    if (!target) {
      throw new Error(
        "Usage: osint-agent [--json] [--type domain|username|keyword] [--limit 5] <cible>"
      );
    }

    const report = await runOsintAgent(target, options);
    const output = options.json
      ? JSON.stringify(report, null, 2)
      : formatTextReport(report);

    process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  formatTextReport,
};
