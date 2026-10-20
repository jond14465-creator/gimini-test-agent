import asyncio
import json
import os

from .config import ROOT


async def node(action, **payload):
    environment = {**os.environ, "NODE_USE_ENV_PROXY": "1"}
    process = await asyncio.create_subprocess_exec("node", str(ROOT / "src" / "bridge.js"),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, cwd=ROOT, env=environment)
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(json.dumps({"action": action, **payload}).encode()), 90)
    except BaseException:
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise
    if process.returncode:
        raise RuntimeError("Échec du collecteur Node.js ; vérifier cible et options")
    return json.loads(stdout)
