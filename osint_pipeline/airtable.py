"""Mémoire Airtable avec clés externes stables et upsert rejouable."""

import asyncio
import hashlib
import json
import re

from .http import request_json, ServiceError

SCHEMA = {
    "Runs": {"Key": "singleLineText", "Target": "singleLineText", "StartedAt": "singleLineText",
        "CompletedAt": "singleLineText", "Status": "singleLineText", "Summary": "multilineText"},
    "Sources": {"Key": "singleLineText", "RunId": "singleLineText", "Provider": "singleLineText",
        "RequestUrl": "multilineText", "Status": "singleLineText", "Error": "multilineText"},
    "Observations": {"Key": "singleLineText", "Url": "multilineText", "Title": "multilineText",
        "ContentHash": "singleLineText", "Excerpt": "multilineText", "Status": "singleLineText"},
    "Claims": {"Key": "singleLineText", "RunId": "singleLineText", "Text": "multilineText", "Status": "singleLineText"},
    "EvidenceLinks": {"Key": "singleLineText", "RunId": "singleLineText", "ObservationKey": "singleLineText",
        "SourceKey": "singleLineText", "ClaimKey": "singleLineText", "Quote": "multilineText", "CollectedAt": "singleLineText"},
}


def stable_id(*parts):
    return hashlib.sha256(json.dumps(parts).encode()).hexdigest()


def records_for(report):
    run_id = report["run"]["id"]
    result = {name: [] for name in SCHEMA}
    result["Runs"].append({"Key": run_id, "Target": report["target"],
        "StartedAt": report["run"]["startedAt"], "CompletedAt": report["run"]["completedAt"],
        "Status": report["run"]["status"], "Summary": json.dumps(report["summary"], ensure_ascii=False)})
    for source in report["sources"]:
        result["Sources"].append({"Key": f"{run_id}:{source['id']}", "RunId": run_id,
            "Provider": source["source"], "RequestUrl": source.get("requestUrl") or "",
            "Status": source["status"], "Error": source.get("error") or ""})
    for observation in report["observations"]:
        result["Observations"].append({"Key": observation["id"], "Url": observation["url"],
            "Title": observation["title"][:50000], "ContentHash": observation["contentHash"],
            "Excerpt": observation["snippet"][:50000], "Status": observation["verificationStatus"]})
        for provenance in observation["provenance"]:
            result["EvidenceLinks"].append({"Key": stable_id(run_id, observation["id"], provenance["sourceId"]),
                "RunId": run_id, "ObservationKey": observation["id"],
                "SourceKey": f"{run_id}:{provenance['sourceId']}", "ClaimKey": "", "Quote": "",
                "CollectedAt": provenance["collectedAt"]})
    for claim in report.get("analysis", {}).get("claims", []):
        claim_key = f"{run_id}:{claim['id']}"
        result["Claims"].append({"Key": claim_key, "RunId": run_id, "Text": claim["text"], "Status": claim["verificationStatus"]})
        for citation in claim["citations"]:
            result["EvidenceLinks"].append({"Key": stable_id(claim_key, citation["observation_id"], citation["quote"]),
                "RunId": run_id, "ObservationKey": citation["observation_id"], "SourceKey": "",
                "ClaimKey": claim_key, "Quote": citation["quote"], "CollectedAt": ""})
    # Identical model citations must not become duplicate upsert keys in one batch.
    return {name: list({item["Key"]: item for item in records}.values()) for name, records in result.items()}


class Airtable:
    def __init__(self, client, settings):
        if not re.fullmatch(r"app[A-Za-z0-9]{14}", settings.airtable_base):
            raise ValueError("AIRTABLE_BASE_ID invalide")
        self.client = client
        self.settings = settings
        self.headers = {"Authorization": f"Bearer {settings.airtable_token}"}

    async def schema(self, create=False):
        url = f"https://api.airtable.com/v0/meta/bases/{self.settings.airtable_base}/tables"
        response = await request_json(self.client, "GET", url, headers=self.headers, timeout=self.settings.timeout)
        if not isinstance(response.get("tables"), list):
            raise ServiceError("Schéma Airtable illisible")
        try:
            tables = {table["name"]: table for table in response["tables"]}
            for name, fields in SCHEMA.items():
                if name not in tables:
                    continue
                actual = {field["name"]: field["type"] for field in tables[name]["fields"]}
                if not tables[name].get("id") or any(actual.get(key) != kind for key, kind in fields.items()):
                    raise ServiceError(f"Schéma Airtable incompatible : {name}")
        except (KeyError, TypeError):
            raise ServiceError("Schéma Airtable illisible") from None
        # Check every existing table before the first mutation, including tables
        # that appear after a missing table in the creation order.
        for name, fields in SCHEMA.items():
            if name not in tables:
                if not create:
                    raise ServiceError(f"Table Airtable manquante : {name}. Exécuter init-airtable.")
                tables[name] = await request_json(self.client, "POST", url, headers=self.headers,
                    payload={"name": name, "fields": [{"name": key, "type": kind} for key, kind in fields.items()]},
                    timeout=self.settings.timeout)
                await asyncio.sleep(0.25)
            actual = {field["name"]: field["type"] for field in tables[name].get("fields", [])}
            if not tables[name].get("id") or any(actual.get(key) != kind for key, kind in fields.items()):
                raise ServiceError(f"Schéma Airtable incompatible : {name}")
        return {name: tables[name]["id"] for name in SCHEMA}

    async def sync(self, report):
        tables = await self.schema()
        counts = {}
        for name, records in records_for(report).items():
            counts[name] = 0
            for offset in range(0, len(records), 10):
                batch = records[offset:offset + 10]
                response = await request_json(self.client, "PATCH",
                    f"https://api.airtable.com/v0/{self.settings.airtable_base}/{tables[name]}", headers=self.headers,
                    payload={"performUpsert": {"fieldsToMergeOn": ["Key"]},
                        "records": [{"fields": fields} for fields in batch]}, timeout=self.settings.timeout)
                returned = response.get("records", [])
                if len(returned) != len(batch) or any(item.get("details") for item in returned):
                    raise ServiceError(f"Écriture Airtable incomplète : {name}")
                counts[name] += len(batch)
                await asyncio.sleep(0.25)
        return counts
