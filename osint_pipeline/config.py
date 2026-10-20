from dataclasses import dataclass, field
from pathlib import Path
import os

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    openai_key: str = field(default="", repr=False)
    firecrawl_key: str = field(default="", repr=False)
    airtable_token: str = field(default="", repr=False)
    airtable_base: str = ""
    model: str = "gpt-5-mini"
    max_pages: int = 3
    timeout: float = 30

    def __post_init__(self):
        if not 1 <= self.max_pages <= 10:
            raise ValueError("max_pages doit être compris entre 1 et 10")
        if not 1 <= self.timeout <= 60:
            raise ValueError("timeout doit être compris entre 1 et 60 secondes")

    @classmethod
    def from_env(cls):
        load_dotenv(ROOT / ".env.local", override=False)
        return cls(
            openai_key=os.getenv("OPENAI_API_KEY", ""),
            firecrawl_key=os.getenv("FIRECRAWL_API_KEY", ""),
            airtable_token=os.getenv("AIRTABLE_TOKEN", ""),
            airtable_base=os.getenv("AIRTABLE_BASE_ID", ""),
            model=os.getenv("OPENAI_MODEL", "gpt-5-mini"),
        )

    def require(self, *, ai=True, firecrawl=True, airtable=False):
        required = []
        if ai and not self.openai_key:
            required.append("OPENAI_API_KEY")
        if firecrawl and not self.firecrawl_key:
            required.append("FIRECRAWL_API_KEY")
        if airtable:
            if not self.airtable_token:
                required.append("AIRTABLE_TOKEN")
            if not self.airtable_base:
                required.append("AIRTABLE_BASE_ID")
        if required:
            raise ValueError("Configuration manquante : " + ", ".join(required))
