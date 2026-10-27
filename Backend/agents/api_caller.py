"""Provider and API-key failover for supported LLM APIs."""

import json
import os
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _load_dotenv() -> None:
    """Load project .env values without overriding process environment values."""
    env_path = Path(__file__).resolve().parents[2] / ".env"
    try:
        lines = env_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip("\"'"))


_load_dotenv()


class LLMError(RuntimeError):
    """Raised when every configured provider and key fails."""


PROVIDERS = {
    "nvidia": {"keys": "NVIDIA_API_KEYS", "single": "NVIDIA_API_KEY",
               "model_env": "NVIDIA_MODEL", "model": "nvidia/nemotron-3-super-120b-a12b",
               "url": "https://integrate.api.nvidia.com/v1/chat/completions", "kind": "openai"},
    "groq": {"keys": "GROQ_API_KEYS", "single": "GROQ_API_KEY",
             "model_env": "GROQ_MODEL", "model": "openai/gpt-oss-20b",
             "url": "https://api.groq.com/openai/v1/chat/completions", "kind": "openai"},
    "gemini": {"keys": "GEMINI_API_KEYS", "single": "GEMINI_API_KEY",
               "model_env": "GEMINI_MODEL", "model": "gemini-3.5-flash-lite",
               "url": "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}", "kind": "gemini"},
    "openrouter": {"keys": "OPENROUTER_API_KEYS", "single": "OPENROUTER_API_KEY",
                   "model_env": "OPENROUTER_MODEL", "model": "openrouter/free",
                   "url": "https://openrouter.ai/api/v1/chat/completions", "kind": "openai"},
    "deepseek": {"keys": "DEEPSEEK_API_KEYS", "single": "DEEPSEEK_API_KEY",
                 "model_env": "DEEPSEEK_MODEL", "model": "deepseek-flash",
                 "url": "https://api.deepseek.com/chat/completions", "kind": "openai"},
    "ollama": {"keys": "OLLAMA_API_KEYS", "single": "OLLAMA_API_KEY",
               "model_env": "OLLAMA_MODEL", "model": "deepseek-v4.1-flash",
               "url": "https://ollama.com/v1/chat/completions", "kind": "openai"},
}

# Cooldowns are process-local and keyed by provider/key. Keys are never logged.
_cooldowns: dict[tuple[str, str], float] = {}


def _keys(config: dict) -> list[str]:
    keys = [key.strip() for key in os.getenv(config["keys"], "").split(",") if key.strip()]
    single = os.getenv(config["single"], "").strip()
    if single and single not in keys:
        keys.append(single)
    return list(dict.fromkeys(keys))


def _providers() -> list[str]:
    selected = os.getenv("LLM_PROVIDER", "auto").strip().lower()
    fallback = os.getenv("LLM_FALLBACK_PROVIDERS", "nvidia,groq,gemini,openrouter,deepseek,ollama")
    ordered = [name.strip().lower() for name in fallback.split(",") if name.strip()]
    if selected != "auto":
        if selected not in PROVIDERS:
            raise LLMError(f"Unsupported LLM_PROVIDER: {selected}")
        ordered = [selected] + [name for name in ordered if name != selected]
    return [name for name in dict.fromkeys(ordered) if name in PROVIDERS]


def _request(provider: str, config: dict, api_key: str, system_prompt: str,
             user_prompt: str, temperature: float, timeout: int) -> str:
    model = os.getenv(config["model_env"], config["model"])
    if config["kind"] == "gemini":
        url = config["url"].format(model=model, key=api_key)
        payload = {"systemInstruction": {"parts": [{"text": system_prompt}]},
                   "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                   "generationConfig": {"temperature": temperature}}
    else:
        url = os.getenv(f"{provider.upper()}_BASE_URL", config["url"])
        payload = {"model": model, "temperature": temperature,
                   "messages": [{"role": "system", "content": system_prompt},
                                {"role": "user", "content": user_prompt}]}
    request = Request(url, data=json.dumps(payload).encode(), headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {api_key}"
    }, method="POST")
    with urlopen(request, timeout=timeout) as response:
        data = json.loads(response.read().decode())
    if config["kind"] == "gemini":
        return data["candidates"][0]["content"]["parts"][0]["text"]
    return data["choices"][0]["message"]["content"]


def complete(system_prompt: str, user_prompt: str, *, temperature: float = 0.2) -> str:
    """Try configured keys/providers in order, cooling down failed credentials."""
    timeout = int(os.getenv("LLM_TIMEOUT_SECONDS", "45"))
    failures = []
    now = time.monotonic()
    candidates = []
    for provider in _providers():
        config = PROVIDERS[provider]
        for api_key in _keys(config):
            if _cooldowns.get((provider, api_key), 0) <= now:
                candidates.append((provider, config, api_key))
    # Probe again if every configured key is cooling down; do not stall requests.
    if not candidates:
        for provider in _providers():
            config = PROVIDERS[provider]
            candidates.extend((provider, config, api_key) for api_key in _keys(config))

    for provider, config, api_key in candidates:
        identity = (provider, api_key)
        try:
            result = _request(provider, config, api_key, system_prompt, user_prompt,
                              temperature, timeout)
            _cooldowns.pop(identity, None)
            return result
        except HTTPError as exc:
            status = exc.code
            cooldown = 3600 if status in (401, 403) else 60 if status == 429 else 20
            _cooldowns[identity] = time.monotonic() + cooldown
            failures.append(f"{provider}: HTTP {status}")
        except (URLError, TimeoutError, OSError, ValueError, KeyError, IndexError) as exc:
            _cooldowns[identity] = time.monotonic() + 20
            failures.append(f"{provider}: {type(exc).__name__}")

    if not candidates:
        raise LLMError("No provider API keys configured. Add keys to the project .env file.")
    raise LLMError("All configured LLM providers failed (" + "; ".join(failures) + ")")
