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
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip()
        # Strip surrounding quotes; keep inner '#' (only a full-line comment is a comment).
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if name:
            os.environ.setdefault(name, value)


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
               "model_env": "GEMINI_MODEL", "model": "gemini-2.0-flash",
               "url": "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}", "kind": "gemini"},
    "openrouter": {"keys": "OPENROUTER_API_KEYS", "single": "OPENROUTER_API_KEY",
                   "model_env": "OPENROUTER_MODEL", "model": "openrouter/free",
                   "url": "https://openrouter.ai/api/v1/chat/completions", "kind": "openai"},
    "deepseek": {"keys": "DEEPSEEK_API_KEYS", "single": "DEEPSEEK_API_KEY",
                 "model_env": "DEEPSEEK_MODEL", "model": "deepseek-chat",
                 "url": "https://api.deepseek.com/chat/completions", "kind": "openai"},
    "ollama": {"keys": "OLLAMA_API_KEYS", "single": "OLLAMA_API_KEY",
               "model_env": "OLLAMA_MODEL", "model": "llama3.1:8b",
               "url": "https://ollama.com/v1/chat/completions", "kind": "openai"},
}

# Caps so one request can never run unbounded across every configured credential.
MAX_ATTEMPTS = int(os.getenv("LLM_MAX_ATTEMPTS", "6"))
MAX_TOTAL_SECONDS = float(os.getenv("LLM_TOTAL_TIMEOUT_SECONDS", "120"))

# Cooldowns are process-local and keyed by provider/key. Keys are never logged.
_cooldowns: dict[tuple[str, str], float] = {}


def _prune_cooldowns(now: float) -> None:
    """Drop expired cooldown entries so the dict cannot grow without bound."""
    if len(_cooldowns) > 64:
        expired = [k for k, until in _cooldowns.items() if until <= now]
        for key in expired:
            _cooldowns.pop(key, None)


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
    unknown = [name for name in ordered if name not in PROVIDERS]
    if unknown:
        raise LLMError(f"Unknown providers in LLM_FALLBACK_PROVIDERS: {', '.join(unknown)}")
    if selected != "auto":
        if selected not in PROVIDERS:
            raise LLMError(f"Unsupported LLM_PROVIDER: {selected}")
        ordered = [selected] + [name for name in ordered if name != selected]
    return list(dict.fromkeys(ordered))


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
        candidate = data.get("candidates", [{}])[0] if data.get("candidates") else {}
        parts = candidate.get("content", {}).get("parts", [])
        if not parts:
            # Blocked or empty candidate: surface the real reason as an API error
            # instead of blaming the credential.
            reason = data.get("promptFeedback", {}).get("blockReason") or candidate.get(
                "finishReason") or "empty response"
            raise LLMError(f"gemini: request rejected ({reason})")
        return parts[0]["text"]
    return data["choices"][0]["message"]["content"]


def complete(system_prompt: str, user_prompt: str, *, temperature: float = 0.2) -> str:
    """Try configured keys/providers in order, cooling down failed credentials.

    Network-level failures (DNS blips, timeouts, connection resets) do NOT cool
    keys down — only credential-level failures (401/403) and rate limits (429) do,
    so one dead network path cannot lock out every key. Total attempts and wall
    time are capped so a single request can never run for many minutes.
    """
    providers = _providers()  # validates configuration before any network call
    timeout = int(os.getenv("LLM_TIMEOUT_SECONDS", "45"))
    deadline = time.monotonic() + MAX_TOTAL_SECONDS
    failures = []
    candidates = []
    now = time.monotonic()
    for provider in providers:
        config = PROVIDERS[provider]
        for api_key in _keys(config):
            if _cooldowns.get((provider, api_key), 0) <= now:
                candidates.append((provider, config, api_key))
    _prune_cooldowns(now)
    # Probe again if every configured key is cooling down; do not stall requests.
    if not candidates:
        for provider in providers:
            config = PROVIDERS[provider]
            candidates.extend((provider, config, api_key) for api_key in _keys(config))

    if not candidates:
        raise LLMError("No provider API keys configured. Add keys to the project .env file.")

    attempted = 0
    for provider, config, api_key in candidates:
        if attempted >= MAX_ATTEMPTS or time.monotonic() >= deadline:
            break
        identity = (provider, api_key)
        attempted += 1
        try:
            result = _request(provider, config, api_key, system_prompt, user_prompt,
                              temperature, timeout)
            _cooldowns.pop(identity, None)
            return result
        except HTTPError as exc:
            status = exc.code
            if status in (401, 403):
                _cooldowns[identity] = time.monotonic() + 3600  # bad credential
                failures.append(f"{provider}: HTTP {status} (credential rejected)")
            elif status == 429:
                _cooldowns[identity] = time.monotonic() + 60  # rate limited
                failures.append(f"{provider}: HTTP 429 (rate limited)")
            else:
                # 5xx / other server errors are transient: do not cool the key.
                failures.append(f"{provider}: HTTP {status}")
        except LLMError:
            raise  # provider-level rejection (e.g. Gemini block) — not a key problem
        except (URLError, TimeoutError, OSError) as exc:
            # Network-level failure: the key may be fine, so keep it usable.
            failures.append(f"{provider}: {type(exc).__name__}")
        except (ValueError, KeyError, IndexError) as exc:
            # Malformed response body: provider-side issue, not a credential one.
            failures.append(f"{provider}: malformed response ({type(exc).__name__})")

    raise LLMError("All configured LLM providers failed (" + "; ".join(failures) + ")")
