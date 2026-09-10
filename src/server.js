"use strict";

const http = require("node:http");

const { runOsintAgent } = require("./agent");
const { formatTextReport } = require("./report");

function getLimit(value) {
  if (value == null || value === "") {
    return undefined;
  }

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error("La limite doit être un entier entre 1 et 10.");
  }

  return limit;
}

function send(res, statusCode, body, contentType) {
  res.writeHead(statusCode, { "content-type": contentType });
  res.end(body);
}

function createServer(options = {}) {
  const runAgent = options.runAgent || runOsintAgent;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method !== "GET") {
      send(res, 405, JSON.stringify({ error: "Méthode non autorisée." }), "application/json");
      return;
    }

    if (url.pathname === "/health") {
      send(res, 200, JSON.stringify({ status: "ok" }), "application/json");
      return;
    }

    if (url.pathname === "/") {
      send(
        res,
        200,
        JSON.stringify({
          name: "gimini-test-agent",
          endpoints: ["/health", "/osint?target=example.com", "/osint?target=octocat&format=text"],
        }),
        "application/json"
      );
      return;
    }

    if (url.pathname !== "/osint") {
      send(res, 404, JSON.stringify({ error: "Route introuvable." }), "application/json");
      return;
    }

    try {
      const target = url.searchParams.get("target") || "";
      const type = url.searchParams.get("type") || undefined;
      const limit = getLimit(url.searchParams.get("limit"));
      const format = url.searchParams.get("format") || "json";
      const report = await runAgent(target, { type, limit });

      if (format === "text") {
        send(res, 200, `${formatTextReport(report)}\n`, "text/plain; charset=utf-8");
        return;
      }

      send(res, 200, JSON.stringify(report, null, 2), "application/json");
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message }), "application/json");
    }
  });
}

function startServer(options = {}) {
  const port = options.port || 3000;
  const host = options.host || "127.0.0.1";
  const server = createServer(options);

  server.listen(port, host, () => {
    process.stdout.write(`API OSINT disponible sur http://${host}:${port}\n`);
  });

  return server;
}

module.exports = {
  createServer,
  startServer,
};
