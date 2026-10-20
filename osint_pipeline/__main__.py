import argparse
import asyncio
import json
from pathlib import Path
import sys

import httpx
from openai import APIStatusError

from .config import Settings, ROOT
from .firecrawl import Firecrawl
from .analysis import Analyst
from .airtable import Airtable
from .workflow import build_workflow, write_receipt
from .http import ServiceError
from .diagnostics import openai_error_code


async def execute(args):
    settings = Settings.from_env()
    if args.command == "doctor":
        print(json.dumps({"OPENAI_API_KEY": bool(settings.openai_key),
            "FIRECRAWL_API_KEY": bool(settings.firecrawl_key),
            "AIRTABLE_TOKEN": bool(settings.airtable_token), "AIRTABLE_BASE_ID": bool(settings.airtable_base)}, indent=2))
        return 0
    settings.require(ai=args.command == "check-openai" or (args.command == "run" and not args.no_ai),
        firecrawl=args.command == "run" and not args.no_firecrawl,
        airtable=args.command in ("check-airtable", "init-airtable", "sync-airtable") or
            (args.command == "run" and args.sync_airtable))
    async with httpx.AsyncClient() as client:
        if args.command == "check-openai":
            # Synthetic evidence for an access/protocol check; never saved as real OSINT data.
            analysis = await Analyst(settings).analyze({"target": "Test technique synthétique",
                "observations": [{"id": "synthetic-test", "url": "https://example.com/",
                    "title": "Extrait synthétique", "snippet": "Ceci est une donnée synthétique pour tester l'analyse structurée."}]})
            print(json.dumps({"status": "accessible", "structuredOutput": "valid",
                "claimCount": len(analysis.claims)}, indent=2))
            return 0
        if args.command == "check-airtable":
            tables = await Airtable(client, settings).schema()
            print(json.dumps({"status": "accessible", "schema": "compatible", "tableCount": len(tables)}, indent=2))
            return 0
        if args.command == "init-airtable":
            tables = await Airtable(client, settings).schema(create=True)
            print(json.dumps({"tables": tables}, indent=2))
            return 0
        if args.command == "sync-airtable":
            file = Path(args.report).resolve()
            report = json.loads(file.read_text())
            try:
                result = await Airtable(client, settings).sync(report)
            except ServiceError:
                write_receipt(file.parent, {"airtable": {"status": "failed"},
                    "issues": ["Synchronisation incomplète ; les mêmes clés peuvent être rejouées."]})
                raise
            write_receipt(file.parent, {"airtable": {"status": "synced", "records": result}})
            print(json.dumps({"status": "synced", "records": result}, indent=2))
            return 0
        settings = Settings(**{**settings.__dict__, "max_pages": args.max_pages})
        memory = Airtable(client, settings) if args.sync_airtable else None
        # Fail before paid calls if the requested destination is incompatible.
        if memory:
            await memory.schema()
        workflow = build_workflow(firecrawl=None if args.no_firecrawl else Firecrawl(client, settings),
            analyst=None if args.no_ai else Analyst(settings), airtable=memory, output_dir=args.output)
        state = await workflow.ainvoke({"target": args.target, "type": args.type})
        print(json.dumps({"run": state["report"]["run"], "directory": state["directory"],
            "observations": len(state["report"]["observations"]), "airtable": state["sync_result"],
            "issues": state["issues"], "diagnostics": state["diagnostics"]}, ensure_ascii=False, indent=2))
        return 1 if state["issues"] else 0


def main():
    parser = argparse.ArgumentParser(description="Pipeline OSINT LangGraph + Agents SDK + Firecrawl + Airtable")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor", help="Vérifier la présence des variables sans afficher leurs valeurs")
    commands.add_parser("check-airtable", help="Vérifier accès et schéma Airtable en lecture seule")
    commands.add_parser("check-openai", help="Tester une analyse structurée courte sur une donnée synthétique")
    commands.add_parser("init-airtable", help="Créer uniquement les tables manquantes dans la base configurée")
    sync = commands.add_parser("sync-airtable", help="Rejouer une sauvegarde locale vers Airtable sans collecte ni IA")
    sync.add_argument("report")
    run = commands.add_parser("run")
    run.add_argument("target")
    run.add_argument("--type", choices=["domain", "username", "keyword"])
    run.add_argument("--output", default=str(ROOT / "reports"))
    run.add_argument("--max-pages", type=int, default=3, choices=range(1, 11))
    run.add_argument("--no-ai", action="store_true")
    run.add_argument("--no-firecrawl", action="store_true")
    run.add_argument("--sync-airtable", action="store_true", help="Activer explicitement l'écriture dans la base configurée")
    args = parser.parse_args()
    try:
        return asyncio.run(execute(args))
    except APIStatusError as error:
        code = openai_error_code(error)
        detail = f" ({code})" if code else ""
        print(f"OpenAI HTTP {error.status_code}{detail}", file=sys.stderr)
        return 1
    except (ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Exécution interrompue", file=sys.stderr)
        return 130
    except Exception:
        print("Échec de l'intégration ; aucun identifiant n'est affiché. Vérifier configuration et schéma.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
