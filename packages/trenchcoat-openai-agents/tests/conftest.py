import pytest
import trenchcoat_openai_agents.hooks as _hooks_module


@pytest.fixture(autouse=True)
def reset_default_config():
    _hooks_module._default_config = None
    yield
    _hooks_module._default_config = None
