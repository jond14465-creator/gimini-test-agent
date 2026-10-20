from datetime import datetime, timezone
import asyncio
import json
from pathlib import Path
import tempfile
import os
from typing import TypedDict

from langgraph.graph import StateGraph, START, END

from .analysis import verify
from .models import Analysis
from .bridge import node
from .http import ServiceError
from .diagnostics import service_diagnostic


class State(TypedDict, total=False):
    diagnostics: list
    target: str
    type: str
    pages: list
    collection_error: str
    report: dict
    raw_analysis: Analysis
    directory: str
    stages: list
    issues: list
    sync_result: dict


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def stage(state, name):
    return [*state.get("stages", []), {"at": now(), "action": name}]


def write_receipt(directory, data):
    destination = Path(directory) / "integration.json"
    descriptor, temporary = tempfile.mkstemp(prefix=".integration-", dir=directory)
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def build_workflow(*, firecrawl, analyst, airtable, output_dir, bridge=node):
    async def research(state):
        started_at = now()
        await bridge("validate", target=state["target"], type=state.get("type"))
        pages, error = [], ""
        if firecrawl is not None:
            try:
                pages = await firecrawl.search(state["target"])
            except ServiceError as exception:
                error = str(exception)
        return {"pages": pages, "collection_error": error,
            "stages": [*state.get("stages", []), {"at": started_at, "action": "research"}]}

    async def collect(state):
        report = await bridge("collect", target=state["target"], type=state.get("type"))
        additional = []
        if firecrawl is not None:
            if state.get("collection_error"):
                additional = [{"id": "firecrawl", "source": "Firecrawl", "status": "failed",
                    "requestUrl": "https://api.firecrawl.dev/v2/search", "collectedAt": now(),
                    "findings": [], "error": state["collection_error"]}]
            else:
                additional = [await firecrawl.collect(state["pages"])]
        report = await bridge("enrich", report=report, sources=additional)
        report["integrations"] = {"firecrawl": "enabled" if firecrawl else "disabled",
            "openai": "enabled" if analyst else "disabled", "airtable": "requested" if airtable else "disabled"}
        return {"report": report, "stages": stage(state, "collect")}

    async def analyze(state):
        issues = list(state.get("issues", []))
        diagnostics = list(state.get("diagnostics", []))
        if analyst is None:
            analysis = Analysis(summary="Analyse IA désactivée.", claims=[], limitations=["Aucun modèle IA exécuté."])
        else:
            try:
                analysis = await analyst.analyze(state["report"])
            except asyncio.CancelledError:
                raise
            except Exception as error:
                # Provider exceptions may contain request metadata; never persist their bodies.
                issues.append("Échec de l'analyse OpenAI ; observations conservées localement.")
                diagnostics.append(service_diagnostic(error, "openai"))
                analysis = Analysis(summary="Analyse IA indisponible.", claims=[], limitations=["Échec de l'appel au modèle."])
        return {"raw_analysis": analysis, "issues": issues, "diagnostics": diagnostics, "stages": stage(state, "analyze")}

    async def verification(state):
        report = dict(state["report"])
        report["analysis"] = verify(state["raw_analysis"], report)
        report["diagnostics"] = state["diagnostics"]
        if state["issues"]:
            report["integrations"]["openai"] = "failed"
            report["run"]["status"] = "partial"
        report["run"]["completedAt"] = now()
        report["run"]["startedAt"] = state["stages"][0]["at"]
        report["summary"]["generatedAt"] = report["run"]["completedAt"]
        report["journal"] = [event for event in report["journal"] if event["action"] != "run_finished"]
        for source in report["sources"]:
            if source["id"] == "firecrawl":
                report["journal"].append({"runId": report["run"]["id"], "at": source["collectedAt"],
                    "action": "source_finished", "sourceId": source["id"], "status": source["status"],
                    "findingCount": len(source["findings"])})
        report["journal"].extend({"runId": report["run"]["id"], **event} for event in state["stages"])
        report["journal"].append({"runId": report["run"]["id"], "at": now(), "action": "verification_finished",
            "acceptedClaims": len(report["analysis"]["claims"]), "rejectedClaims": report["analysis"]["rejectedClaims"]})
        report["journal"].sort(key=lambda event: event["at"])
        report["journal"].append({"runId": report["run"]["id"], "at": now(), "action": "run_finished"})
        return {"report": report, "stages": stage(state, "verify")}

    async def local_report(state):
        saved = await bridge("save", report=state["report"], outputDir=str(output_dir))
        return {"directory": saved["directory"], "stages": stage(state, "local_report")}

    async def memory(state):
        issues = list(state["issues"])
        diagnostics = list(state.get("diagnostics", []))
        result = {"status": "disabled"}
        if airtable is not None:
            try:
                result = {"status": "synced", "records": await airtable.sync(state["report"])}
            except ServiceError as error:
                issues.append("Synchronisation Airtable incomplète ; relancer sync-airtable sur le rapport sauvegardé.")
                result = {"status": "failed"}
                diagnostics.append(service_diagnostic(error, "airtable"))
        stages = stage(state, "memory")
        receipt = {"airtable": result, "issues": issues, "diagnostics": diagnostics, "stages": stages}
        write_receipt(state["directory"], receipt)
        return {"sync_result": result, "issues": issues, "diagnostics": diagnostics, "stages": stages}

    graph = StateGraph(State)
    for name, handler in [("research", research), ("collect", collect), ("analyze", analyze),
                          ("verify", verification), ("local_report", local_report), ("memory", memory)]:
        graph.add_node(name, handler)
    steps = [START, "research", "collect", "analyze", "verify", "local_report", "memory", END]
    for previous, following in zip(steps, steps[1:]):
        graph.add_edge(previous, following)
    return graph.compile()
