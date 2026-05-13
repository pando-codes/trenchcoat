from __future__ import annotations

from fastapi import FastAPI

from ._core import TrenchcoatConfig
from .bot_router import make_bot_router
from .copilot_router import make_copilot_router


def create_app(config: TrenchcoatConfig) -> FastAPI:
    """Return a FastAPI app with the GitHub Copilot Extension and M365 Bot Framework routes."""
    app = FastAPI(title="Trenchcoat Copilot Extension")
    app.include_router(make_copilot_router(config))
    app.include_router(make_bot_router(config))
    return app
