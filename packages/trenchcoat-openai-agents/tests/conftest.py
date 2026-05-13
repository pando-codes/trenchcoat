import pytest

try:
    import trenchcoat_openai_agents.hooks as _hooks_module
except ImportError:
    _hooks_module = None


@pytest.fixture(autouse=True)
def reset_default_config():
    if _hooks_module is not None:
        _hooks_module._default_config = None
    yield
    if _hooks_module is not None:
        _hooks_module._default_config = None
