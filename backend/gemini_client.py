"""Minimal Gemini REST client: report parts (inline, Files API or text), and
generateContent with structured JSON output.

The REST format for structured output has changed over time, so the call tries
the current form first and falls back to older ones. Whatever comes back is
validated locally against the output schema in app.py.
"""
import base64
import hashlib
import json
import os
import re
import time
from pathlib import Path

import requests

BASE = "https://generativelanguage.googleapis.com"
ROOT = Path(__file__).parent
CACHE = ROOT / "data" / "cache"
CACHE.mkdir(parents=True, exist_ok=True)
FILES_CACHE = CACHE / "gemini_files.json"
INLINE_LIMIT_MB = float(os.environ.get("INLINE_PDF_LIMIT_MB", "18"))


class GeminiError(Exception):
    pass


def _key():
    k = os.environ.get("GEMINI_API_KEY", "").strip()
    if not k:
        raise GeminiError("GEMINI_API_KEY is not set. Add it to the .env file and restart the server.")
    return k


def _headers(extra=None):
    h = {"x-goog-api-key": _key()}
    h.update(extra or {})
    return h


# ---------------------------------------------------------------- reports

def _fingerprint(path):
    st = path.stat()
    return hashlib.sha1(f"{path.resolve()}|{st.st_size}|{st.st_mtime_ns}".encode()).hexdigest()


def _load_files_cache():
    try:
        return json.loads(FILES_CACHE.read_text())
    except Exception:
        return {}


def upload_pdf(path, log):
    """Upload with the Files API (resumable). Files expire after 48 h, so cache for 46 h."""
    cache = _load_files_cache()
    fp = _fingerprint(path)
    hit = cache.get(fp)
    if hit and hit["expires"] > time.time():
        log(f"Reusing uploaded file for {path.name}")
        return hit["uri"]
    size = path.stat().st_size
    log(f"Uploading {path.name} ({size / 1e6:.1f} MB) to the Gemini Files API")
    start = requests.post(
        f"{BASE}/upload/v1beta/files",
        headers=_headers({
            "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(size),
            "X-Goog-Upload-Header-Content-Type": "application/pdf",
            "Content-Type": "application/json"}),
        json={"file": {"display_name": path.name}}, timeout=60)
    if start.status_code >= 400:
        raise GeminiError(f"File upload start failed ({start.status_code}): {start.text[:300]}")
    url = start.headers.get("x-goog-upload-url") or start.headers.get("X-Goog-Upload-URL")
    if not url:
        raise GeminiError("File upload start returned no upload URL.")
    with open(path, "rb") as f:
        done = requests.post(url, headers={"Content-Length": str(size), "X-Goog-Upload-Offset": "0",
                                           "X-Goog-Upload-Command": "upload, finalize"},
                             data=f, timeout=600)
    if done.status_code >= 400:
        raise GeminiError(f"File upload failed ({done.status_code}): {done.text[:300]}")
    info = done.json().get("file", {})
    name, uri = info.get("name"), info.get("uri")
    for _ in range(60):                      # wait until processed
        state = info.get("state", "ACTIVE")
        if state == "ACTIVE":
            break
        if state == "FAILED":
            raise GeminiError(f"Gemini could not process {path.name}.")
        time.sleep(2)
        info = requests.get(f"{BASE}/v1beta/{name}", headers=_headers(), timeout=30).json()
    cache[fp] = {"uri": uri, "name": name, "expires": time.time() + 46 * 3600}
    FILES_CACHE.write_text(json.dumps(cache, indent=1))
    return uri


def pdf_text(path, max_chars, log):
    """Extract text with pypdf (cached). Page markers keep page citations possible."""
    cache = CACHE / f"{_fingerprint(path)}.txt"
    if cache.exists():
        text = cache.read_text(encoding="utf-8")
    else:
        from pypdf import PdfReader
        log(f"Extracting text from {path.name}")
        reader = PdfReader(str(path))
        text = "\n".join(f"[page {i + 1}]\n{(p.extract_text() or '').strip()}" for i, p in enumerate(reader.pages))
        cache.write_text(text, encoding="utf-8")
    if len(text) > max_chars:
        text = text[:max_chars] + f"\n[truncated after {max_chars} characters]"
    return text


def report_parts(psi_id, reports, mode, log, query=None):
    parts = []
    for path in reports:
        label = {"text": f"REPORT {psi_id}: {path.name}"}
        if mode == "text":
            from pipeline import select_report_pages
            full = pdf_text(path, 10_000_000, log)
            excerpt = select_report_pages(full, query or {})
            log(f"{path.name}: sending {excerpt.count('[page ')} relevant pages ({len(excerpt) // 1000}k characters)")
            parts += [{"text": f"REPORT {psi_id}: {path.name} (relevant pages only)"}, {"text": excerpt}]
        elif path.stat().st_size / 1e6 <= INLINE_LIMIT_MB:
            data = base64.b64encode(path.read_bytes()).decode()
            parts += [label, {"inlineData": {"mimeType": "application/pdf", "data": data}}]
        else:
            parts += [label, {"fileData": {"mimeType": "application/pdf", "fileUri": upload_pdf(path, log)}}]
    return parts


# ---------------------------------------------------------------- generate

SCHEMA_MODES = ["responseFormat", "responseJsonSchema", "promptOnly"]
_working_mode = {"mode": None}
_thinking_ok = {"ok": True}
TRANSIENT = (500, 502, 503, 504)


def _gen_config(mode, schema, thinking):
    cfg = {}
    max_tokens = os.environ.get("GEMINI_MAX_OUTPUT_TOKENS", "").strip()
    if max_tokens:
        cfg["maxOutputTokens"] = int(max_tokens)
    if thinking:
        cfg["thinkingConfig"] = {"thinkingLevel": thinking}
    if mode == "responseFormat":
        cfg["responseFormat"] = {"text": {"mimeType": "APPLICATION_JSON", "schema": schema}}
    elif mode == "responseJsonSchema":
        cfg["responseMimeType"] = "application/json"
        cfg["responseJsonSchema"] = schema
    else:
        cfg["responseMimeType"] = "application/json"
    return cfg


def _extract_text(data):
    cands = data.get("candidates") or []
    if not cands:
        block = (data.get("promptFeedback") or {}).get("blockReason")
        raise GeminiError(f"Gemini returned no answer{' (blocked: ' + block + ')' if block else ''}.")
    c = cands[0]
    text = "".join(p.get("text", "") for p in (c.get("content") or {}).get("parts", []) if not p.get("thought"))
    if c.get("finishReason") == "MAX_TOKENS":
        raise GeminiError("The answer was cut off at the output token limit. Raise GEMINI_MAX_OUTPUT_TOKENS "
                          "or use fewer reports.")
    return text


def parse_json(text):
    t = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", t, re.S)
    if m:
        t = m.group(1)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        s, e = t.find("{"), t.rfind("}")
        if s >= 0 and e > s:
            return json.loads(t[s:e + 1])
        raise


def _post(model, body, log, label):
    t0 = time.time()
    timeout = int(os.environ.get("GEMINI_TIMEOUT_S", "60"))
    try:
        r = requests.post(f"{BASE}/v1beta/models/{model}:generateContent",
                          headers=_headers({"Content-Type": "application/json"}), json=body, timeout=timeout)
    except requests.exceptions.Timeout:
        log(f"{label}: no answer after {timeout} s (timed out)")
        return None
    except requests.exceptions.ConnectionError as e:
        log(f"{label}: connection error after {time.time() - t0:.0f} s: {e}")
        return None
    log(f"{label}: HTTP {r.status_code} after {time.time() - t0:.0f} s")
    return r


def _short_error(r):
    try:
        return r.json().get("error", {}).get("message", r.text)[:300]
    except Exception:
        return r.text[:300]


def generate(model, system_prompt, parts, schema, log):
    """Call generateContent. Returns (text, schema_mode, usage, model_used).

    - 400: the request format was not accepted -> try the next structured-output format
      (or drop the thinking setting if that was the problem).
    - 500/502/503/504: Google is overloaded -> wait 10 s and retry once, then try
      GEMINI_FALLBACK_MODEL if set. The format is NOT changed for these errors.
    - timeout (no answer within GEMINI_TIMEOUT_S, default 60 s): an occasional stalled
      request -> retry once straight away, then try the fallback model.
    """
    fallback = os.environ.get("GEMINI_FALLBACK_MODEL", "gemini-3.1-flash-lite").strip()
    models = [model] + ([fallback] if fallback and fallback != model else [])
    thinking = os.environ.get("GEMINI_THINKING_LEVEL", "").strip() or ("minimal" if "lite" in model else "low")
    format_errors, transient_errors = [], []
    for current in models:
        modes = [_working_mode["mode"]] if _working_mode["mode"] else list(SCHEMA_MODES)
        i = 0
        retried_transient = False
        while i < len(modes):
            mode = modes[i]
            body_parts = list(parts)
            if mode == "promptOnly":
                body_parts.append({"text": "OUTPUT JSON SCHEMA\n" + json.dumps(schema)})
            body = {
                "systemInstruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"role": "user", "parts": body_parts}],
                "generationConfig": _gen_config(mode, schema, thinking if _thinking_ok["ok"] else ""),
            }
            label = f"{current} ({mode}{', thinking ' + thinking if thinking and _thinking_ok['ok'] else ''})"
            log(f"Calling {label}")
            r = _post(current, body, log, label)
            if r is None or r.status_code in TRANSIENT:
                transient_errors.append(f"{current}: {'timeout' if r is None else r.status_code}")
                if not retried_transient:
                    retried_transient = True
                    if r is None:
                        log("No answer in time; retrying once")
                    else:
                        log("Google is busy; waiting 10 s and retrying once")
                        time.sleep(10)
                    continue
                log(f"{current} still unavailable" + ("; switching to fallback model" if current != models[-1] else ""))
                break
            if r.status_code in (401, 403):
                raise GeminiError(f"Gemini rejected the API key ({r.status_code}): {_short_error(r)}")
            if r.status_code == 429:
                raise GeminiError("Gemini rate limit or quota reached (429). Wait a minute and try again, or check your plan.")
            if r.status_code == 404 and current != model:
                transient_errors.append(f"{current}: model not found (check GEMINI_FALLBACK_MODEL)")
                break
            if r.status_code == 404:
                raise GeminiError(f"Model '{current}' was not found (404). Set GEMINI_MODEL in .env to an available model.")
            if r.status_code >= 400:
                msg = _short_error(r)
                if _thinking_ok["ok"] and thinking and "thinking" in msg.lower():
                    log("Thinking setting not accepted; retrying without it")
                    _thinking_ok["ok"] = False
                    continue
                format_errors.append(f"{mode}: {r.status_code} {msg}")
                log(f"{mode} not accepted ({r.status_code}); trying next format")
                i += 1
                continue
            data = r.json()
            _working_mode["mode"] = mode
            return _extract_text(data), mode, data.get("usageMetadata", {}), current
        if format_errors and not transient_errors:
            break
    if transient_errors:
        raise GeminiError(
            "Google's servers are overloaded or timed out (" + ", ".join(transient_errors) + "). "
            "This is on Google's side. Try again in a few minutes, choose 'Extracted report text' or "
            "'Records only' for a lighter request, or set GEMINI_FALLBACK_MODEL in .env.")
    raise GeminiError("Gemini did not accept any request format:\n" + "\n".join(format_errors))


def repair(model, bad_json_text, errors, schema, log):
    """One cheap retry: send only the invalid JSON and the validation errors.
    Returns the same tuple as generate()."""
    prompt = ("This JSON does not satisfy the output schema. Fix only what the errors require; "
              "keep all content otherwise unchanged. Return the corrected JSON only.\n\nERRORS\n"
              + "\n".join(errors) + "\n\nJSON\n" + bad_json_text)
    return generate(model, "You repair JSON so it satisfies a JSON schema.", [{"text": prompt}], schema, log)
