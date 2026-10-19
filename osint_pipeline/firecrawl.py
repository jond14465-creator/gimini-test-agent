from datetime import datetime, timezone
import ipaddress
from urllib.parse import urlsplit

from .http import request_json, ServiceError


def public_url(value):
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if parsed.scheme not in ("https", "http") or not host or parsed.username or parsed.password:
            return False
        if parsed.port not in (None, 80, 443):
            return False
        if host.lower().rstrip(".").endswith(("localhost", ".local", ".internal")):
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return "." in host and all(part for part in host.rstrip(".").split("."))
    except (ValueError, TypeError):
        return False


class Firecrawl:
    def __init__(self, client, settings):
        self.client = client
        self.settings = settings

    async def call(self, endpoint, payload):
        result = await request_json(self.client, "POST", f"https://api.firecrawl.dev/v2/{endpoint}",
            headers={"Authorization": f"Bearer {self.settings.firecrawl_key}"},
            payload=payload, timeout=self.settings.timeout)
        if result.get("success") is not True:
            raise ServiceError("Firecrawl n'a pas confirmé la réussite")
        return result.get("data")

    async def search(self, query):
        data = await self.call("search", {"query": query, "limit": self.settings.max_pages,
            "sources": ["web"], "timeout": int(self.settings.timeout * 1000)})
        if not isinstance(data, dict) or not isinstance(data.get("web"), list):
            raise ServiceError("Résultats Firecrawl search invalides")
        return [item for item in data["web"] if isinstance(item, dict) and public_url(item.get("url"))][:self.settings.max_pages]

    async def collect(self, results):
        findings, failures = [], []
        for item in results[:self.settings.max_pages]:
            url = item["url"]
            if not public_url(url):
                continue
            try:
                data = await self.call("scrape", {"url": url, "formats": ["markdown"],
                    "onlyMainContent": True, "timeout": int(self.settings.timeout * 1000)})
                if not isinstance(data, dict) or not isinstance(data.get("markdown"), str):
                    raise ServiceError("Contenu Firecrawl scrape invalide")
                metadata = data.get("metadata") or {}
                if not isinstance(metadata, dict):
                    raise ServiceError("Métadonnées Firecrawl invalides")
                final_url = metadata.get("sourceURL", url)
                if not public_url(final_url):
                    raise ServiceError("URL finale non publique")
                findings.append({"title": str(metadata.get("title") or item.get("title") or url),
                    "url": final_url, "snippet": data["markdown"][:12000]})
            except ServiceError as error:
                failures.append({"url": url, "error": str(error)})
        return {"id": "firecrawl", "source": "Firecrawl", "requestUrl": "https://api.firecrawl.dev/v2/search",
            "collectedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "findings": findings,
            "status": "failed" if failures else "collected",
            "error": "Collecte Firecrawl partielle" if failures else None, "failures": failures}
