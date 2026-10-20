"""Classify provider errors without returning arbitrary provider text or secrets."""


def openai_error_code(error):
    body = getattr(error, "body", None)
    payload = body.get("error", body) if isinstance(body, dict) else {}
    if not isinstance(payload, dict):
        payload = {}
    allowed = {"invalid_api_key", "insufficient_quota", "model_not_found", "permission_denied",
        "unsupported_parameter", "rate_limit_exceeded"}
    for candidate in (getattr(error, "code", None), payload.get("code"), payload.get("type")):
        if isinstance(candidate, str) and candidate in allowed:
            return candidate
    # Older provider responses can omit the machine-readable code.
    message = str(payload.get("message", "")).lower()
    if getattr(error, "status_code", None) == 429:
        if any(term in message for term in ("current quota", "billing quota", "run out of credits", "no balance left")):
            return "insufficient_quota"
        if any(term in message for term in ("rate limit", "requests per minute", "tokens per minute")):
            return "rate_limit_exceeded"
    return None


def service_diagnostic(error, service):
    result = {"service": service}
    status = getattr(error, "status_code", None)
    if isinstance(status, int):
        result["httpStatus"] = status
    if service == "openai":
        code = openai_error_code(error)
    else:
        code = getattr(error, "code", None)
        if code not in {"INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND", "AUTHENTICATION_REQUIRED",
            "INVALID_VALUE_FOR_COLUMN", "UNKNOWN_FIELD_NAME", "INVALID_RECORDS",
            "DUPLICATE_RECORDS", "INVALID_REQUEST_BODY", "NOT_FOUND"}:
            code = None
    if code:
        result["code"] = code
    elif isinstance(error, TimeoutError):
        result["code"] = "timeout"
    else:
        result["code"] = "unclassified_error"
    return result
