"""Provider base URLs and per-provider API key pools."""

from app.config import ExtraProvider, Settings, mask_key

# All providers speak the OpenAI chat-completions API at these base URLs.
BASE_URLS = {
    "nvidia": "https://integrate.api.nvidia.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "openrouter": "https://openrouter.ai/api/v1",
    "deepseek": "https://api.deepseek.com",
}
PROVIDERS = tuple(BASE_URLS)


class KeyPool:
    """One provider's API keys. A key rejected with 401/403 is disabled for the session."""

    def __init__(self, keys: list[str]) -> None:
        self.keys = keys
        self.disabled: set[int] = set()

    def active(self) -> list[tuple[int, str]]:
        """(index, key) for every key that still works, in .env order."""
        return [(i, k) for i, k in enumerate(self.keys) if i not in self.disabled]

    def disable(self, index: int) -> None:
        self.disabled.add(index)

    @property
    def configured(self) -> bool:
        return bool(self.keys)

    def masked(self, index: int) -> str:
        return mask_key(self.keys[index])


def base_urls(extras: list[ExtraProvider]) -> dict[str, str]:
    """Base URL of every provider: the built-in ones, then the EXTRA_PROVIDERS from .env."""
    return {**BASE_URLS, **{p.name: p.base_url for p in extras}}


def key_pools(settings: Settings, extras: list[ExtraProvider] | None = None) -> dict[str, KeyPool]:
    """Key pools from settings (<PROVIDER>_API_KEYS). Empty pool = provider disabled."""
    pools = {
        name: KeyPool(
            [k.get_secret_value() for k in getattr(settings, f"{name}_api_keys")]
        )
        for name in PROVIDERS
    }
    for extra in extras or []:
        pools[extra.name] = KeyPool([k.get_secret_value() for k in extra.keys])
    return pools
