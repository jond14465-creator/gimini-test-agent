"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { formatMarkdownReport } = require("./report");

async function saveReport(report, outputDir) {
  if (!/^[0-9a-f-]{36}$/.test(report.run?.id || "")) throw new Error("Identifiant d'exécution invalide.");
  const root = path.resolve(outputDir);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const temporary = await fs.mkdtemp(path.join(root, ".pending-"));
  const destination = path.join(root, report.run.id);
  try {
    const files = {
      "report.json": JSON.stringify(report, null, 2),
      "report.md": formatMarkdownReport(report),
      "graph.json": JSON.stringify(report.graph, null, 2),
      "journal.jsonl": report.journal.map(entry => JSON.stringify(entry)).join("\n"),
    };
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(temporary, name), `${content}\n`, { mode: 0o600, flag: "wx" });
    }
    await fs.rename(temporary, destination);
    return destination;
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { saveReport };
