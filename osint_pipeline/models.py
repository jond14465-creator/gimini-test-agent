"""Contrats de sortie de l'analyse IA, sans permissions d'action distante."""

from pydantic import BaseModel, ConfigDict, Field


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    observation_id: str
    quote: str = Field(min_length=1, max_length=1200)


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)
    citations: list[Citation] = Field(min_length=1, max_length=5)


class Analysis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(max_length=5000)
    claims: list[Claim] = Field(max_length=10)
    limitations: list[str] = Field(max_length=10)
