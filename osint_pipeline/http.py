"""HTTP borné : erreurs sans corps distants ni identifiants."""

import asyncio
import httpx


class ServiceError(RuntimeError):
    pass


async def request_json(client, method, url, *, headers, payload=None, timeout=30, retries=2):
    for attempt in range(retries + 1):
        try:
            response = await client.request(method, url, headers=headers, json=payload,
                                            timeout=timeout, follow_redirects=False)
        except httpx.HTTPError:
            # Do not retry an ambiguous POST: it may already have incurred a charge.
            raise ServiceError("Transport distant indisponible") from None
        if response.status_code in (429, 502, 503, 504) and attempt < retries:
            # POST requests are only retried for an explicit rate-limit rejection.
            if method == "POST" and response.status_code != 429:
                raise ServiceError(f"Service HTTP {response.status_code}")
            raw = response.headers.get("Retry-After", "")
            delay = float(raw) if raw.replace(".", "", 1).isdigit() else 2 ** attempt
            if delay > 30:
                raise ServiceError("Limite distante : reprise différée nécessaire")
            await asyncio.sleep(max(0.25, delay))
            continue
        if not 200 <= response.status_code < 300:
            raise ServiceError(f"Service HTTP {response.status_code}")
        try:
            result = response.json()
        except ValueError:
            raise ServiceError("Réponse JSON distante invalide") from None
        if not isinstance(result, dict):
            raise ServiceError("Structure JSON distante invalide")
        return result
    raise ServiceError("Nombre maximal de tentatives atteint")
