"use strict";

function validateOptions(options = {}) {
  if (options.type != null && !["domain", "username", "keyword"].includes(options.type)) {
    throw new Error("Le type doit être domain, username ou keyword.");
  }
  if (options.limit != null && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10)) {
    throw new Error("La limite doit être un entier entre 1 et 10.");
  }
  if (options.timeoutMs != null && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60000)) {
    throw new Error("Le délai doit être un entier entre 1 et 60000 ms.");
  }
  if (options.format != null && !["json", "text"].includes(options.format)) {
    throw new Error("Le format doit être json ou text.");
  }
}

module.exports = { validateOptions };
