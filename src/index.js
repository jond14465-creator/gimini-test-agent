#!/usr/bin/env node
"use strict";

const { runOsintAgent } = require("./agent");
const { formatTextReport } = require("./report");
const { startServer } = require("./server");

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

function parseServeArgs(argv) {
  const values = [...argv];
  const options = { port: 3000, host: "127.0.0.1" };

  while (values[0]?.startsWith("--")) {
    const option = values.shift();

    if (option === "--port") {
      options.port = Number(values.shift() || "3000");
      if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
        throw new Error("Le port doit être un entier entre 1 et 65535.");
      }
      continue;
    }

    if (option === "--host") {
      options.host = values.shift() || "127.0.0.1";
      continue;
    }

    throw new Error(`Option inconnue: ${option}`);
  }

  return options;
}

async function main() {
  try {
    const argv = process.argv.slice(2);

    if (argv[0] === "serve") {
      startServer(parseServeArgs(argv.slice(1)));
      return;
    }

    const { target, options } = parseArgs(argv);

    if (!target) {
      throw new Error(
        "Usage: osint-agent [--json] [--type domain|username|keyword] [--limit 5] <cible>\n       osint-agent serve [--host 127.0.0.1] [--port 3000]"
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
  parseServeArgs,
  formatTextReport,
};
