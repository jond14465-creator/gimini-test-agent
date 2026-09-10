"use strict";

const BLOCKED_PATTERNS = [
  /\b(?:password|mot\s*de\s*passe|secret|token|api[-_\s]?key)\b/i,
  /\b(?:ssn|social\s*security|iban|credit\s*card|carte\s*bancaire)\b/i,
];

function detectTargetType(target) {
  if (/^(?:https?:\/\/)?(?:[\w-]+\.)+[\w-]{2,}$/i.test(target)) {
    return "domain";
  }

  if (/^[\w.-]{2,39}$/i.test(target) && !/\s/.test(target)) {
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
};
