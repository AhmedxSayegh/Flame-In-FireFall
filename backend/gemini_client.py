"""Minimal Gemini REST client: report parts (inline, Files API or text), and
generateContent with structured JSON output.

The REST format for structured output has changed over time, so the call tries
the current form first and falls back to older ones. Whatever comes back is
validated locally against the output schema in app.py.
"""
import hashlib
import json
import os
import re
import time
from pathlib import Path

import requests

from pipeline import bounded_setting

BASE = "https://generativelanguage.googleapis.com"
ROOT = Path(__file__).parent
CACHE = ROOT / "data" / "cache"
CACHE.mkdir(parents=True, exist_ok=True)
FILES_CACHE = CACHE / "gemini_files.json"
REPAIR_MAX_CHARS = 16_000


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


def _timeout(deadline, limit):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise GeminiError("The Gemini search time budget expired.")
    return min(limit, remaining)


def upload_pdf(path, log, deadline):
    """Upload one PDF with bounded processing polls, caching only active files."""
    cache = _load_files_cache()
    fp = _fingerprint(path)
    hit = cache.get(fp)
    if hit and hit["expires"] > time.time():
        log(f"Reusing uploaded file for {path.name}")
        return hit["uri"]
    size = path.stat().st_size
    log(f"Uploading {path.name} ({size / 1e6:.1f} MB) to the Gemini Files API")
    try:
        start = requests.post(
            f"{BASE}/upload/v1beta/files",
            headers=_headers({
                "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(size),
                "X-Goog-Upload-Header-Content-Type": "application/pdf",
                "Content-Type": "application/json"}),
            json={"file": {"display_name": path.name}}, timeout=_timeout(deadline, 15))
        start.raise_for_status()
        url = start.headers.get("x-goog-upload-url")
        if not url:
            raise GeminiError(f"File upload returned no upload URL for {path.name}.")
        with path.open("rb") as f:
            done = requests.post(url, headers={"Content-Length": str(size), "X-Goog-Upload-Offset": "0",
                                               "X-Goog-Upload-Command": "upload, finalize"},
                                 data=f, timeout=_timeout(deadline, 40))
        done.raise_for_status()
        info = done.json()["file"]
        name = info["name"]
        for poll in range(7):
            if info.get("state") == "ACTIVE" and info.get("uri"):
                cache[fp] = {"uri": info["uri"], "expires": time.time() + 46 * 3600}
                FILES_CACHE.write_text(json.dumps(cache, indent=1), encoding="utf-8")
                return info["uri"]
            if info.get("state") == "FAILED" or poll == 6:
                break
            time.sleep(_timeout(deadline, 1))
            status = requests.get(f"{BASE}/v1beta/{name}", headers=_headers(), timeout=_timeout(deadline, 5))
            status.raise_for_status()
            info = status.json()
    except (requests.RequestException, ValueError, KeyError) as exc:
        raise GeminiError(f"Could not upload or check {path.name}. Use extracted report text if the problem persists.") from exc
    raise GeminiError(f"Gemini did not finish processing {path.name} within the file polling limit.")


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


def report_parts(investigations, mode, log, query, deadline):
    from pipeline import select_report_pages
    if mode == "none":
        return [], []
    paths = [(inv["psi_id"], path) for inv in investigations for path in inv["reports"]]
    budget = bounded_setting("REPORT_EXCERPT_CHARS", 12_000, 2_400, 24_000)
    share = budget // max(1, len(paths))
    parts, used = [], []
    for psi_id, path in paths:
        _timeout(deadline, 1)
        label = f"REPORT {psi_id}: {path.name}"
        if mode == "text":
            try:
                full = pdf_text(path, 10_000_000, log)
            except Exception as exc:
                log(f"{path.name}: text extraction failed ({type(exc).__name__})")
                continue
            preferred = (21, 58, 109, 54, 83) if psi_id == "PSI-25" and path.name == "BASS-II_Summary_Report.pdf" else ()
            excerpt = select_report_pages(full, query, share, preferred)
            if not excerpt:
                log(f"{path.name}: no usable report text")
                continue
            log(f"{path.name}: sending {excerpt.count('[page ')} page excerpts ({len(excerpt)} characters)")
            parts += [{"text": label + " (PDF page excerpts)"}, {"text": excerpt}]
        else:
            parts += [{"text": label},
                      {"fileData": {"mimeType": "application/pdf", "fileUri": upload_pdf(path, log, deadline)}}]
        used.append(f"{psi_id}/reports/{path.name}")
    return parts, used


# ---------------------------------------------------------------- generate

SCHEMA_MODES = ["responseFormat", "responseJsonSchema", "promptOnly"]
_working_modes = {}
_no_thinking = set()
TRANSIENT = (500, 502, 503, 504)


def _gen_config(mode, schema, thinking):
    cfg = {"maxOutputTokens": bounded_setting("GEMINI_MAX_OUTPUT_TOKENS", 4096, 1024, 8192)}
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
        raise GeminiError("Gemini returned no answer.")
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


def generate(model, system_prompt, parts, schema, log, deadline, *, repair_only=False):
    """Spend at most three generation requests, or one request for JSON repair."""
    fallback = os.environ.get("GEMINI_FALLBACK_MODEL", "gemini-3.1-flash-lite").strip()
    current = model
    rejected = set()
    for attempt in range(1 if repair_only else 3):
        preferred = _working_modes.get(current, SCHEMA_MODES[0])
        modes = [preferred, *(mode for mode in SCHEMA_MODES if mode != preferred)]
        mode = next((mode for mode in modes if (current, mode) not in rejected), None)
        if mode is None:
            break
        thinking = ""
        if current not in _no_thinking and not repair_only:
            thinking = os.environ.get("GEMINI_THINKING_LEVEL", "").strip() or ("minimal" if "lite" in current else "low")
        body_parts = list(parts)
        if mode == "promptOnly":
            body_parts.append({"text": "OUTPUT JSON SCHEMA\n" + json.dumps(schema, separators=(",", ":"))})
        body = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": body_parts}],
            "generationConfig": _gen_config(mode, schema, thinking),
        }
        timeout = _timeout(deadline, bounded_setting("GEMINI_TIMEOUT_S", 30, 1, 40))
        log(f"Calling Gemini model {current} ({mode}, request {attempt + 1})")
        start = time.monotonic()
        try:
            r = requests.post(f"{BASE}/v1beta/models/{current}:generateContent",
                              headers=_headers({"Content-Type": "application/json"}), json=body, timeout=timeout)
        except (requests.Timeout, requests.ConnectionError):
            r = None
        except requests.RequestException as exc:
            raise GeminiError("Gemini request failed.") from exc
        status = r.status_code if r is not None else None
        log(f"Gemini returned {status or 'a network failure'} after {time.monotonic() - start:.1f} s")
        if status is None or status in TRANSIENT or status == 404:
            if fallback and current == model and fallback != model:
                current = fallback
            continue
        if status == 400:
            if thinking and "thinking" in r.text.lower():
                _no_thinking.add(current)
            else:
                rejected.add((current, mode))
            continue
        if status == 429:
            raise GeminiError("Gemini rate limit or quota reached (429).")
        if status >= 400:
            raise GeminiError(f"Gemini rejected the request (HTTP {status}).")
        try:
            data = r.json()
            answer = _extract_text(data)
        except (ValueError, TypeError, AttributeError) as exc:
            raise GeminiError("Gemini returned an invalid response envelope.") from exc
        _working_modes[current] = mode
        return answer, mode, data.get("usageMetadata", {}), current
    raise GeminiError("Gemini did not return a result within the request limit. Check the model settings or try extracted report text.")


def repair(model, bad_json_text, errors, schema, log, deadline):
    """Repair structure once. Do not resend source material or oversized answers."""
    if len(bad_json_text) > REPAIR_MAX_CHARS:
        raise GeminiError("The invalid Gemini answer exceeded the JSON repair size limit.")
    prompt = ("Fix only the JSON structure required by the errors. Keep investigation and experiment IDs "
              "and preserve the scope of all scientific statements. Return the corrected JSON only.\n\nERRORS\n"
              + "\n".join(errors) + "\n\nJSON\n" + bad_json_text)
    return generate(model, "Repair JSON formatting and structure.", [{"text": prompt}], schema, log,
                    deadline, repair_only=True)
