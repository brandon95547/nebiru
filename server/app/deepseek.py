"""DeepSeek chat-completion client."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

import httpx

from .config import Settings
from .errors import NotConfigured, ServiceError

# A message's content is text, or a list of text and image parts.
Message = dict[str, Any]

MAX_CONTINUATIONS = 3
JSON_TOKEN_CEILING = 16000
CONTINUE_PROMPT = (
    "Your reply was cut off by the length limit. Continue from exactly where it stopped, "
    "mid-sentence if need be. Do not repeat anything already written and do not add any preamble."
)


def parse_json_loose(raw: str) -> Any:
    """Parse model output that should be JSON but may be fenced or wrapped in prose."""
    text = raw.strip()
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(text[start : end + 1])


class DeepSeek:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client

    async def _complete(
        self,
        messages: list[Message],
        *,
        max_tokens: int,
        temperature: float,
        json_mode: bool = False,
        vision: bool = False,
    ) -> tuple[str, str | None]:
        """One completion. Returns the content and the reason generation stopped."""
        settings = self._settings
        if settings.text_problem:
            raise NotConfigured(settings.text_problem)

        payload: dict[str, Any] = {
            "model": (settings.deepseek_vision_model if vision else "") or settings.deepseek_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
            # v4 models reason by default and bill that against max_tokens. Budgets
            # here are sized for the answer alone, so reasoning would leave it empty.
            "thinking": {"type": "disabled"},
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        url = f"{settings.deepseek_base_url}/v1/chat/completions"
        headers = {"Authorization": f"Bearer {settings.deepseek_api_key}"}
        attempts = settings.deepseek_max_retries + 1
        failure = "DeepSeek could not be reached."

        attempt = 0
        while attempt < attempts:
            attempt += 1
            try:
                response = await self._client.post(
                    url, json=payload, headers=headers, timeout=settings.deepseek_timeout_s
                )
            except httpx.TimeoutException:
                failure = f"DeepSeek did not answer within {settings.deepseek_timeout_s:.0f} seconds."
            except httpx.HTTPError as error:
                failure = f"DeepSeek could not be reached ({error.__class__.__name__})."
            else:
                status = response.status_code
                if status == 200:
                    choices = response.json().get("choices") or []
                    content = ((choices[0].get("message") or {}).get("content") or "") if choices else ""
                    if not content.strip():
                        raise ServiceError("DeepSeek returned an empty response.")
                    return content, choices[0].get("finish_reason")

                body = response.text[:500]
                if status == 400 and "thinking" in body and "thinking" in payload:
                    # An older model that does not know the parameter: drop it and ask again.
                    del payload["thinking"]
                    attempt -= 1
                    continue
                if status == 401:
                    raise ServiceError("DeepSeek rejected the API key (HTTP 401).")
                if status == 402:
                    raise ServiceError("The DeepSeek account has no balance left (HTTP 402).")
                if status == 429 or status >= 500:
                    failure = f"DeepSeek is busy or unavailable (HTTP {status})."
                else:
                    raise ServiceError(f"DeepSeek refused the request (HTTP {status}): {body}")

            if attempt < attempts:
                await asyncio.sleep(min(2.0 * attempt, 6.0))

        raise ServiceError(failure)

    async def text(
        self, messages: list[Message], *, max_tokens: int = 8000, temperature: float = 0.7, vision: bool = False
    ) -> str:
        """Prose of any length: when the model hits its limit it is asked to carry on.

        `vision` marks a request that carries an image, so it goes to the model that reads them.
        """
        conversation = list(messages)
        pieces: list[str] = []
        for _ in range(MAX_CONTINUATIONS + 1):
            content, finish = await self._complete(
                conversation, max_tokens=max_tokens, temperature=temperature, vision=vision
            )
            pieces.append(content)
            if finish != "length":
                break
            conversation += [
                {"role": "assistant", "content": content},
                {"role": "user", "content": CONTINUE_PROMPT},
            ]
        return "".join(pieces).strip()

    async def json(
        self, messages: list[Message], *, max_tokens: int = 4000, temperature: float = 0.4
    ) -> Any:
        """A JSON document. A truncated reply is retried with a larger budget."""
        budget = max_tokens
        while True:
            content, finish = await self._complete(
                messages, max_tokens=budget, temperature=temperature, json_mode=True
            )
            try:
                return parse_json_loose(content)
            except json.JSONDecodeError:
                if finish == "length" and budget < JSON_TOKEN_CEILING:
                    budget = min(JSON_TOKEN_CEILING, budget * 2)
                    continue
                raise ServiceError("DeepSeek returned a reply that was not valid JSON.") from None

    async def balance(self) -> dict[str, Any]:
        """Account balance, used to warn before work starts on an empty account."""
        settings = self._settings
        if settings.text_problem:
            raise NotConfigured(settings.text_problem)
        try:
            response = await self._client.get(
                f"{settings.deepseek_base_url}/user/balance",
                headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
                timeout=10.0,
            )
        except httpx.HTTPError as error:
            raise ServiceError(f"DeepSeek could not be reached ({error.__class__.__name__}).") from None
        if response.status_code == 401:
            raise ServiceError("DeepSeek rejected the API key (HTTP 401).")
        if response.status_code != 200:
            raise ServiceError(f"DeepSeek balance check failed (HTTP {response.status_code}).")
        return response.json()
