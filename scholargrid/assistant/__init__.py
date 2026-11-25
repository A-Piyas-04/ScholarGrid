"""Research assistant: one controlled tool-using orchestrator that answers a question with a cited brief.
See :mod:`scholargrid.assistant.brief` for the guardrails."""
from __future__ import annotations

from .brief import brief_key, build_brief, load_cached_brief, to_markdown

__all__ = ["build_brief", "brief_key", "load_cached_brief", "to_markdown"]
