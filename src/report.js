"use strict";

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

function markdownText(value) {
  return String(value).replace(/[\r\n]+/g, " ").replace(/&/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#!|~]/g, "\\$&");
}

function formatMarkdownReport(report) {
  const lines = ["# Rapport OSINT", "",
    `Cible : ${markdownText(report.target)}`, "",
    `Exécution : ${markdownText(report.run?.id || "non disponible")}`, "",
    "Les observations sont non vérifiées. Un résultat de recherche ne prouve ni une identité ni une relation réelle.", "",
    `Observations uniques : ${report.observations?.length || 0}`, "",
    "## Observations", ""];
  for (const [index, observation] of (report.observations || []).entries()) {
    lines.push(`### O${index + 1} — ${markdownText(observation.title)}`, "",
      markdownText(observation.snippet), "",
      `URL : ${markdownText(observation.url)}`, "",
      `Empreinte du contenu : ${observation.contentHash}`, "");
    for (const provenance of observation.provenance) {
      lines.push(`- ${markdownText(provenance.source)} ; collecte : ${provenance.collectedAt}`);
    }
    lines.push("");
  }
  lines.push("## Graphe des résultats", "",
    "Les arêtes indiquent uniquement qu'une requête a retourné une observation.", "", "```mermaid", "graph TD", '  Q["Requête"]');
  for (const [index] of (report.observations || []).entries()) {
    lines.push(`  Q --> O${index + 1}["Observation ${index + 1}"]`);
  }
  lines.push("```", "", "## Chronologie des collectes", "",
    "Les dates ci-dessous sont des dates de collecte, pas des dates d'événements.", "");
  for (const entry of report.timeline || []) {
    lines.push(`- ${entry.collectedAt} : ${markdownText(entry.sourceId)} ; observation ${entry.observationId}`);
  }
  lines.push("", "## État des sources", "");
  for (const source of report.sources) {
    lines.push(`- ${markdownText(source.source)} : ${markdownText(source.status || (source.error ? "failed" : "collected"))}`);
  }
  if (report.analysis) {
    lines.push("", "## Analyse IA", "", "Résumé du modèle non vérifié :", "", markdownText(report.analysis.summary), "");
    for (const claim of report.analysis.claims || []) {
      lines.push(`- ${markdownText(claim.text)} (citation correspondante ; fait non vérifié)`);
      for (const citation of claim.citations) {
        lines.push(`  - ${markdownText(citation.quote)} — observation ${citation.observation_id}`);
      }
    }
    lines.push("", "### Limites de l'analyse", "");
    for (const limitation of report.analysis.limitations || []) lines.push(`- ${markdownText(limitation)}`);
  }
  lines.push("", markdownText(report.disclaimer));
  return lines.join("\n");
}

module.exports = {
  formatTextReport,
  formatMarkdownReport,
};
