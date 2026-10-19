"use strict";

const { createHash } = require("node:crypto");

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["fbclid", "gclid"].includes(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch {
    return null;
  }
}

// Identical content is deduplicated; different excerpts remain distinct evidence.
// Repeated mentions do not establish factual truth or identity equivalence.
function buildEvidence(sources, target, collectedAt) {
  const observations = new Map();
  let rejectedFindings = 0;
  let validFindings = 0;
  for (const source of sources) {
    for (const finding of source.findings) {
      const url = canonicalUrl(finding?.url);
      if (!url || typeof finding.title !== "string" || !finding.title.trim() ||
          typeof finding.snippet !== "string") {
        rejectedFindings++;
        continue;
      }
      validFindings++;
      const title = finding.title.trim();
      const snippet = finding.snippet.trim();
      const contentHash = digest([title, snippet]);
      const id = digest([url, contentHash]);
      if (!observations.has(id)) {
        observations.set(id, { id, url, title, snippet, contentHash,
          verificationStatus: "unverified", provenance: [] });
      }
      const provenance = observations.get(id).provenance;
      const sourceId = source.id || source.source;
      if (!provenance.some(item => item.sourceId === sourceId)) {
        provenance.push({ sourceId, source: source.source,
          requestUrl: source.requestUrl || null, collectedAt: source.collectedAt || collectedAt });
      }
    }
  }
  const items = [...observations.values()].sort((a, b) => a.id.localeCompare(b.id));
  const targetId = `target:${digest(target)}`;
  const nodes = [{ id: targetId, kind: "query", label: target }];
  const edges = [];
  for (const item of items) {
    nodes.push({ id: item.id, kind: "observation", label: item.title, url: item.url });
    edges.push({ from: targetId, to: item.id, relation: "search_result" });
    for (const provenance of item.provenance) {
      const sourceId = `source:${provenance.sourceId}`;
      if (!nodes.some(node => node.id === sourceId)) {
        nodes.push({ id: sourceId, kind: "source", label: provenance.source });
      }
      edges.push({ from: sourceId, to: item.id, relation: "reported", collectedAt: provenance.collectedAt });
    }
  }
  const timeline = items.flatMap(item => item.provenance.map(provenance => ({
    observationId: item.id, sourceId: provenance.sourceId,
    collectedAt: provenance.collectedAt, eventAt: null,
  }))).sort((a, b) => a.collectedAt.localeCompare(b.collectedAt) || a.observationId.localeCompare(b.observationId));
  return { observations: items, graph: { nodes, edges }, timeline,
    stats: { uniqueObservations: items.length, duplicateFindings: validFindings - items.length, rejectedFindings } };
}

module.exports = { buildEvidence, canonicalUrl };
