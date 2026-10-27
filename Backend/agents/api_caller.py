"""Provider selection and small HTTP clients for supported LLM APIs."""

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class LLMError(RuntimeError):
    """Raised when no provider is configured or an API request fails."""


def complete(system_prompt: str, user_prompt: str, *, temperature: float = 0.2) -> str:
    """Call Gemini, Groq, or OpenRouter using environment-based credentials."""
    provider = os.getenv("LLM_PROVIDER", "groq").lower()
    timeout = int(os.getenv("LLM_TIMEOUT_SECONDS", "45"))

    if provider == "gemini":
        api_key = os.getenv("GEMINI_API_KEY")
        model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key or ''}"
        payload = {"systemInstruction": {"parts": [{"text": system_prompt}]},
                   "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                   "generationConfig": {"temperature": temperature}}
        extract = lambda data: data["candidates"][0]["content"]["parts"][0]["text"]
    else:
        settings = {
            "groq": ("GROQ_API_KEY", "GROQ_MODEL", "https://api.groq.com/openai/v1/chat/completions", "llama-3.3-70b-versatile"),
            "openrouter": ("OPENROUTER_API_KEY", "OPENROUTER_MODEL", "https://openrouter.ai/api/v1/chat/completions", "openai/gpt-4o-mini"),
        }
        if provider not in settings:
            raise LLMError("LLM_PROVIDER must be gemini, groq, or openrouter")
        key_name, model_name, endpoint, default_model = settings[provider]
        api_key = os.getenv(key_name)
        model = os.getenv(model_name, default_model)
        url = os.getenv("LLM_BASE_URL", endpoint)
        payload = {"model": model, "temperature": temperature,
                   "messages": [{"role": "system", "content": system_prompt},
                                {"role": "user", "content": user_prompt}]}
        extract = lambda data: data["choices"][0]["message"]["content"]

    if not api_key:
        raise LLMError(f"Set the API key for provider '{provider}' in the environment")
    request = Request(url, data=json.dumps(payload).encode(), headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {api_key}"
    }, method="POST")
    try:
        with urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode())
        return extract(data)
    except (HTTPError, URLError, TimeoutError, KeyError, IndexError, ValueError) as exc:
        detail = exc.read().decode(errors="replace")[:500] if isinstance(exc, HTTPError) else str(exc)
        raise LLMError(f"{provider} request failed: {detail}") from exc
