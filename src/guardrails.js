"use strict";

const BLOCKED_PATTERNS = [
  /\b(?:password|mot\s*de\s*passe|secret|token|api[-_\s]?key)\b/i,
  /\b(?:ssn|social\s*security|iban|credit\s*card|carte\s*bancaire)\b/i,
];
const COMMON_DOMAIN_SUFFIXES = new Set([
  "ai",
  "ca",
  "co",
  "com",
  "de",
  "edu",
  "es",
  "fr",
  "gov",
  "io",
  "it",
  "mil",
  "net",
  "org",
  "uk",
  "us",
]);

function normalizeTarget(target) {
  const normalized = String(target || "").trim();

  try {
    const url = normalized.match(/^[a-z][a-z0-9+.-]*:\/\//i)
      ? new URL(normalized)
      : new URL(`https://${normalized}`);
    return url.hostname || normalized;
  } catch {
    return normalized
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/^@/, "")
      .split(/[/?#]/, 1)[0]
      .replace(/\/+$/, "");
  }
}

function detectTargetType(target) {
  const normalized = normalizeTarget(target);
  const hasUrlMarkers =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(target) || /[/?#]/.test(String(target || ""));

  if (/^@[\w.-]{2,39}$/i.test(target)) {
    return "username";
  }

  if (
    !hasUrlMarkers &&
    /^[\w.-]{2,39}$/i.test(normalized) &&
    normalized.includes(".") &&
    normalized.split(".").length === 2
  ) {
    const [, suffix = ""] = normalized.split(".");
    if (!COMMON_DOMAIN_SUFFIXES.has(suffix.toLowerCase())) {
      return "username";
    }
  }

  if (/^(?:[\w-]+\.)+[\w-]{2,}$/i.test(normalized)) {
    return "domain";
  }

  if (/^[\w.-]{2,39}$/i.test(normalized) && !/\s/.test(normalized)) {
    return "username";
  }

  return "keyword";
}

function assertAllowedTarget(target) {
  const normalized = String(target || "").trim();

  if (!normalized) {
    throw new Error("La cible est obligatoire.");
  }

  if (normalized.length < 2 || normalized.length > 120) {
    throw new Error("La cible doit contenir entre 2 et 120 caractères.");
  }

  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    throw new Error("La requête contient des termes interdits.");
  }

  return normalized;
}

module.exports = {
  assertAllowedTarget,
  detectTargetType,
  normalizeTarget,
};
