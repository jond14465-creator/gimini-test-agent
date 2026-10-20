import copy
import json
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from agents import Model, ModelResponse
from agents.usage import Usage
from openai.types.responses import ResponseOutputMessage, ResponseOutputText

from osint_pipeline.analysis import Analyst, verify
from osint_pipeline.airtable import Airtable, SCHEMA, records_for
from osint_pipeline.bridge import node
from osint_pipeline.config import Settings
from osint_pipeline.firecrawl import Firecrawl, public_url
from osint_pipeline.http import ServiceError, request_json
from osint_pipeline.models import Analysis
from osint_pipeline.workflow import build_workflow


def base_report():
    at = "2026-10-19T00:00:00.000Z"
    return {"schemaVersion": "1.1", "target": "example.com", "type": "domain",
        "run": {"id": str(uuid4()), "startedAt": at, "completedAt": at, "status": "completed"},
        "sources": [{"id": "dns", "source": "DNS", "requestUrl": "https://dns.google/resolve",
            "status": "collected", "collectedAt": at, "error": None,
            "findings": [{"title": "Example domain", "snippet": "Example domain has a public record.", "url": "https://example.com"}]}],
        "summary": {"activeSources": 1, "totalFindings": 1},
        "journal": [{"action": "run_started", "at": at}], "disclaimer": "Sources publiques uniquement."}


class TestModel(Model):
    __test__ = False

    async def get_response(self, system_instructions, input, model_settings, tools,
                           output_schema, handoffs, tracing, **kwargs):
        content = input if isinstance(input, str) else input[-1]["content"]
        data = json.loads(content)
        observation = data["observations"][0]
        result = {"summary": "Résumé simulé pour tester le protocole SDK.", "limitations": ["Modèle simulé."],
            "claims": [{"text": "Une observation publique a été collectée.", "citations": [
                {"observation_id": observation["id"], "quote": observation["snippet"]}]}]}
        return ModelResponse(output=[ResponseOutputMessage(id="msg_test", type="message", role="assistant",
            status="completed", content=[ResponseOutputText(type="output_text", text=json.dumps(result), annotations=[])])],
            usage=Usage(), response_id="response_test")

    async def stream_response(self, *args, **kwargs):
        raise NotImplementedError
        yield


@pytest.fixture
def settings():
    return Settings(openai_key="test", firecrawl_key="test", airtable_token="test",
        airtable_base="app12345678901234", max_pages=2)


def mock_transport(request):
    if request.url.host == "api.firecrawl.dev":
        if request.url.path.endswith("search"):
            return httpx.Response(200, json={"success": True, "data": {"web": [
                {"title": "Example", "url": "https://example.com/about"},
                {"url": "http://127.0.0.1/private"}]}})
        return httpx.Response(200, json={"success": True, "data": {"markdown": "Example is a public documentation domain.",
            "metadata": {"title": "About Example", "sourceURL": "https://example.com/about"}}})
    if request.method == "GET":
        return httpx.Response(200, json={"tables": [{"id": "tbl" + name, "name": name,
            "fields": [{"name": field, "type": kind} for field, kind in fields.items()]}
            for name, fields in SCHEMA.items()]})
    payload = json.loads(request.content)
    assert request.method == "PATCH"
    assert payload["performUpsert"] == {"fieldsToMergeOn": ["Key"]}
    assert len(payload["records"]) <= 10
    return httpx.Response(200, json={"records": [{"id": f"rec{index}", **item} for index, item in enumerate(payload["records"])]})


async def test_full_graph_with_real_sdk_runner_and_mock_services(settings, tmp_path, monkeypatch):
    async def no_delay(_):
        pass
    monkeypatch.setattr("osint_pipeline.airtable.asyncio.sleep", no_delay)
    collector_calls = []
    async def bridge(action, **payload):
        if action == "collect":
            collector_calls.append(payload["target"])
            return base_report()
        return await node(action, **payload)
    async with httpx.AsyncClient(transport=httpx.MockTransport(mock_transport)) as client:
        graph = build_workflow(firecrawl=Firecrawl(client, settings), analyst=Analyst(settings, TestModel()),
            airtable=Airtable(client, settings), output_dir=tmp_path, bridge=bridge)
        result = await graph.ainvoke({"target": "example.com", "type": "domain"})
    assert collector_calls == ["example.com"]
    assert [event["action"] for event in result["stages"]] == ["research", "collect", "analyze", "verify", "local_report", "memory"]
    assert len(result["report"]["observations"]) == 2
    assert len(result["report"]["analysis"]["claims"]) == 1
    assert result["report"]["analysis"]["claims"][0]["verificationStatus"] == "citation_matched"
    assert result["sync_result"]["status"] == "synced"
    directory = Path(result["directory"])
    assert {"report.json", "report.md", "graph.json", "journal.jsonl", "integration.json"} == {item.name for item in directory.iterdir()}
    persisted = json.loads((directory / "report.json").read_text())
    assert persisted["analysis"]["claims"]
    assert persisted["journal"][-1]["action"] == "run_finished"
    assert "Analyse IA" in (directory / "report.md").read_text()
    assert result["issues"] == []


async def test_unknown_citations_and_fabricated_quotes_are_rejected():
    report = await node("enrich", report=base_report(), sources=[])
    observation = report["observations"][0]
    analysis = Analysis.model_validate({"summary": "Résumé non vérifié", "limitations": [], "claims": [
        {"text": "Unknown", "citations": [{"observation_id": "invented", "quote": "abc"}]},
        {"text": "Wrong quote", "citations": [{"observation_id": observation["id"], "quote": "fabricated"}]},
        {"text": "Match", "citations": [{"observation_id": observation["id"], "quote": "public record"}]},
    ]})
    checked = verify(analysis, report)
    assert checked["rejectedClaims"] == 2
    assert len(checked["claims"]) == 1
    assert checked["claims"][0]["distinctDomains"] == 1


async def test_partial_airtable_failure_keeps_saved_report_and_replay_keys(settings, tmp_path):
    class FailedMemory:
        async def sync(self, report):
            raise ServiceError("unavailable")
    async def bridge(action, **payload):
        return base_report() if action == "collect" else await node(action, **payload)
    result = await build_workflow(firecrawl=None, analyst=None, airtable=FailedMemory(),
        output_dir=tmp_path, bridge=bridge).ainvoke({"target": "example.com"})
    file = Path(result["directory"]) / "report.json"
    assert file.is_file()
    assert result["sync_result"]["status"] == "failed"
    assert result["issues"]
    report = json.loads(file.read_text())
    assert records_for(report) == records_for(copy.deepcopy(report))
    assert json.loads((file.parent / "integration.json").read_text())["airtable"]["status"] == "failed"


async def test_ai_failure_is_explicit_and_preserves_evidence(tmp_path):
    class FailedAnalyst:
        async def analyze(self, report):
            raise RuntimeError("secret-provider-error-do-not-persist")
    async def bridge(action, **payload):
        return base_report() if action == "collect" else await node(action, **payload)
    result = await build_workflow(firecrawl=None, analyst=FailedAnalyst(), airtable=None,
        output_dir=tmp_path, bridge=bridge).ainvoke({"target": "example.com"})
    assert result["report"]["integrations"]["openai"] == "failed"
    assert result["report"]["run"]["status"] == "partial"
    assert "secret-provider-error" not in json.dumps(result["report"])
    assert len(result["report"]["observations"]) == 1


async def test_target_rejected_before_research_and_billing(settings, tmp_path):
    class MustNotCall:
        async def search(self, target):
            pytest.fail("No research for forbidden target")
    with pytest.raises(RuntimeError):
        await build_workflow(firecrawl=MustNotCall(), analyst=None, airtable=None,
            output_dir=tmp_path).ainvoke({"target": "api key leaked"})


@pytest.mark.parametrize("url", ["http://127.0.0.1", "http://[::1]", "http://10.0.0.1",
    "http://localhost", "http://host.local", "https://example.com:8080", "file:///etc/passwd",
    "https://user:password@example.com", "http://169.254.169.254/latest"])
def test_firecrawl_rejects_obviously_non_public_urls(url):
    assert not public_url(url)


async def test_firecrawl_budget_and_page_errors(settings):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(502, json={"secret": "not logged"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        source = await Firecrawl(client, settings).collect([
            {"url": f"https://example.com/{index}"} for index in range(10)])
    assert len(calls) == settings.max_pages
    assert source["status"] == "failed"
    assert len(source["failures"]) == 2
    assert "secret" not in json.dumps(source)


async def test_airtable_splits_batches_and_rejects_missing_schema(settings, monkeypatch):
    async def no_delay(_):
        pass
    monkeypatch.setattr("osint_pipeline.airtable.asyncio.sleep", no_delay)
    report = await node("enrich", report=base_report(), sources=[])
    original = report["observations"][0]
    report["observations"] = [{**original, "id": str(index)} for index in range(23)]
    sizes = []
    def handler(request):
        if request.method == "PATCH" and request.url.path.endswith("tblObservations"):
            sizes.append(len(json.loads(request.content)["records"]))
        return mock_transport(request)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        counts = await Airtable(client, settings).sync(report)
    assert sizes == [10, 10, 3]
    assert counts["Observations"] == 23
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"tables": []}))) as client:
        with pytest.raises(ServiceError, match="Table Airtable manquante"):
            await Airtable(client, settings).schema()


async def test_rate_limit_has_bounded_retry_without_leaking_body(monkeypatch):
    delays = []
    async def record_delay(seconds):
        delays.append(seconds)
    monkeypatch.setattr("osint_pipeline.http.asyncio.sleep", record_delay)
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(429, headers={"Retry-After": "1"}, json={"secret": "do not log"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ServiceError, match="HTTP 429") as exception:
            await request_json(client, "PATCH", "https://api.airtable.com/v0/test", headers={})
    assert len(calls) == 3
    assert delays == [1, 1]
    assert "secret" not in str(exception.value)


def test_configuration_validation_and_secret_repr(settings):
    assert "openai_key" not in repr(settings)
    with pytest.raises(ValueError, match="Configuration manquante"):
        Settings().require(airtable=True)
    with pytest.raises(ValueError):
        Settings(max_pages=11)


async def test_airtable_initialization_creates_missing_tables_once(settings, monkeypatch):
    async def no_delay(_):
        pass
    monkeypatch.setattr("osint_pipeline.airtable.asyncio.sleep", no_delay)
    tables, created = [], []
    def handler(request):
        if request.method == "GET":
            return httpx.Response(200, json={"tables": tables})
        payload = json.loads(request.content)
        created.append(payload["name"])
        table = {"id": "tbl" + payload["name"], **payload}
        tables.append(table)
        return httpx.Response(200, json=table)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        memory = Airtable(client, settings)
        assert len(await memory.schema(create=True)) == 5
        assert len(await memory.schema(create=True)) == 5
    assert created == list(SCHEMA)


async def test_incompatible_airtable_schema_is_not_mutated(settings):
    methods = []
    def handler(request):
        methods.append(request.method)
        return httpx.Response(200, json={"tables": [{"name": "Runs", "id": "tblRuns",
            "fields": [{"name": "Key", "type": "formula"}]}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ServiceError, match="incompatible"):
            await Airtable(client, settings).schema(create=True)
    assert methods == ["GET"]


async def test_firecrawl_search_malformed_payload_is_explicit(settings):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200,
            json={"success": True, "data": {"unexpected": []}}))) as client:
        with pytest.raises(ServiceError, match="search invalides"):
            await Firecrawl(client, settings).search("example.com")


async def test_later_incompatible_table_prevents_all_creations(settings):
    methods = []
    def handler(request):
        methods.append(request.method)
        return httpx.Response(200, json={"tables": [{"name": "EvidenceLinks", "id": "tblEvidence",
            "fields": [{"name": "Key", "type": "formula"}]}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ServiceError, match="incompatible"):
            await Airtable(client, settings).schema(create=True)
    assert methods == ["GET"]


@pytest.mark.parametrize("payload", [{}, {"tables": None}, {"tables": [None]},
    {"tables": [{"name": "Runs", "id": "tblRuns"}]}])
async def test_unreadable_airtable_schema_prevents_mutations(settings, payload):
    methods = []
    def handler(request):
        methods.append(request.method)
        return httpx.Response(200, json=payload)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ServiceError, match="illisible"):
            await Airtable(client, settings).schema(create=True)
    assert methods == ["GET"]


async def test_check_airtable_command_only_reads_and_needs_no_ai_key(settings, monkeypatch, capsys):
    from argparse import Namespace
    from osint_pipeline.__main__ import execute
    read_settings = Settings(airtable_token=settings.airtable_token, airtable_base=settings.airtable_base)
    monkeypatch.setattr(Settings, "from_env", lambda: read_settings)
    original_client = httpx.AsyncClient
    methods = []
    def handler(request):
        methods.append(request.method)
        return mock_transport(request)
    monkeypatch.setattr("osint_pipeline.__main__.httpx.AsyncClient",
        lambda: original_client(transport=httpx.MockTransport(handler)))
    assert await execute(Namespace(command="check-airtable")) == 0
    assert methods == ["GET"]
    output = capsys.readouterr().out
    assert json.loads(output) == {"status": "accessible", "schema": "compatible", "tableCount": 5}
    assert "Authorization" not in output


async def test_check_openai_command_needs_no_other_service(settings, monkeypatch, capsys):
    from argparse import Namespace
    from osint_pipeline.__main__ import execute
    ai_settings = Settings(openai_key=settings.openai_key)
    monkeypatch.setattr(Settings, "from_env", lambda: ai_settings)
    seen = []
    class SyntheticAnalyst:
        def __init__(self, settings):
            assert settings.openai_key
        async def analyze(self, report):
            seen.append(report)
            return Analysis(summary="Test", claims=[], limitations=["Synthetic"])
    monkeypatch.setattr("osint_pipeline.__main__.Analyst", SyntheticAnalyst)
    assert await execute(Namespace(command="check-openai")) == 0
    assert len(seen) == 1 and seen[0]["observations"][0]["id"] == "synthetic-test"
    assert json.loads(capsys.readouterr().out)["structuredOutput"] == "valid"
