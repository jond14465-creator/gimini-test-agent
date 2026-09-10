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

module.exports = {
  formatTextReport,
};
