"""HTTP API for the ScholarGrid web app.

The research logic lives in the rest of the ``scholargrid`` package; this subpackage only exposes it over
typed JSON endpoints for the Next.js frontend in ``web/``. One process loads the current release once
(:class:`~scholargrid.api.state.AppState`) and long operations run as background jobs
(:mod:`scholargrid.api.jobs`).

Run it with ``python -m scholargrid.api`` (see ``--help``).
"""
from __future__ import annotations

__all__ = ["create_app"]


def create_app(*args, **kwargs):  # pragma: no cover - thin lazy wrapper
    from .main import create_app as _create

    return _create(*args, **kwargs)
