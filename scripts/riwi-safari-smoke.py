#!/usr/bin/env python3
"""Fixed QA checks run by the owner in Terminal's Safari automation context.

Uses native login once, then read-only APIs. Never reads stored password hashes,
exports cookies, creates a browser-control server, or changes browser protection.
"""
from __future__ import annotations

import getpass
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
import uuid

ORIGIN = "https://learners-area-gb825uhb9-learners-area.vercel.app"
COMMIT = "8054d75905e962c390ef2924a143c27f79bb3d7e"
EMAIL = "qa-owner@learnersarea.test"
ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "qa" / "riwi-safari-smoke-last.json"
READS = (
    "/api/frontend/public", "/api/frontend/session", "/api/riwi/targets",
    "/api/riwi/owner/diagnostics", "/api/riwi/owner/assessment-policies",
    "/api/riwi/owner/knowledge", "/api/riwi/owner/security-signals",
)


class SmokeBlocked(Exception):
    pass


def applescript(source: str) -> str:
    try:
        result = subprocess.run(["/usr/bin/osascript", "-"], input=source,
                                text=True, capture_output=True, timeout=12)
    except subprocess.TimeoutExpired:
        raise SmokeBlocked("safari_automation_timeout") from None
    if result.returncode:
        # Raw AppleScript diagnostics can echo source containing login data.
        # Retain only the numeric OS error, never source or stderr text.
        match = re.search(r"\((-?\d+)\)\s*$", result.stderr.strip())
        code = match.group(1) if match else "unknown"
        raise SmokeBlocked("safari_automation_error_" + code)
    return result.stdout.strip()


def javascript(source: str, window_id: int) -> dict:
    guarded = ("(()=>{if(location.origin!==" + json.dumps(ORIGIN) +
               ")return JSON.stringify({blocked:'wrong_origin'});" + source + "})()")
    script = ('tell application "/Applications/Safari.app"\n'
              f"return do JavaScript {json.dumps(guarded)} in current tab of window id {window_id}\n"
              "end tell\n")
    try:
        value = json.loads(applescript(script))
    except json.JSONDecodeError:
        raise SmokeBlocked("invalid_safari_result") from None
    if not isinstance(value, dict):
        raise SmokeBlocked("invalid_safari_result")
    if value.get("blocked"):
        raise SmokeBlocked("safari_" + str(value["blocked"]))
    return value


def request(window_id: int, path: str, *, password: str | None = None) -> dict:
    login = password is not None
    if path not in READS and not (login and path == "/api/auth/login"):
        raise SmokeBlocked("unapproved_test_path")
    slot = "__riwiQa" + uuid.uuid4().hex
    options = {"method": "POST" if login else "GET", "credentials": "same-origin",
               "redirect": "error", "cache": "no-store"}
    if login:
        options["headers"] = {"content-type": "application/json"}
        options["body"] = json.dumps({"email": EMAIL, "password": password})
    # Full response data remains in the page's temporary function scope. Only
    # HTTP status, fixed error codes, role and booleans leave Safari.
    source = (
        f"const slot={json.dumps(slot)};window[slot]={{done:false}};"
        f"const path={json.dumps(path)},options={json.dumps(options)};"
        "const controller=new AbortController();options.signal=controller.signal;"
        "const timer=setTimeout(()=>controller.abort(),20000);"
        "(async()=>{try{const response=await fetch(path,options);"
        "let body;try{body=await response.json()}catch{body=null}"
        "const result={status:response.status,json:body!==null};"
        "if(body&&typeof body.error==='string'&&/^[a-z0-9_:-]{1,80}$/.test(body.error))result.error=body.error;"
        "if(['schema_missing','column_missing','database_missing','unreachable','auth_failed','capacity'].includes(body?.reason))result.reason=body.reason;"
        "if(path==='/api/frontend/public'){result.passwordEnabled=body?.public?.auth?.passwordEnabled===true;}"
        "if(path==='/api/frontend/session'){const user=body?.session?.user;"
        "result.owner=user?.role==='owner';result.active=user?.accountStatus==='active';"
        f"result.expectedAccount=user?.email?.toLowerCase()==={json.dumps(EMAIL)};}}"
        "window[slot]={done:true,result};"
        "}catch{window[slot]={done:true,result:{status:null,error:'browser_request_failed'}}}"
        "finally{clearTimeout(timer)}})();return JSON.stringify({started:true});"
    )
    javascript(source, window_id)
    deadline = time.monotonic() + 25
    try:
        while time.monotonic() < deadline:
            result = javascript(f"return JSON.stringify(window[{json.dumps(slot)}]||{{}});", window_id)
            if result.get("done"):
                return {"path": path, **result["result"]}
            time.sleep(0.3)
        raise SmokeBlocked("browser_request_timeout")
    finally:
        try:
            javascript(f"delete window[{json.dumps(slot)}];return JSON.stringify({{cleaned:true}});", window_id)
        except SmokeBlocked:
            pass


def write_report(report: dict) -> None:
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=REPORT.parent,
                                     prefix=".riwi-smoke-", delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    temporary.replace(REPORT)
    print(f"Natija: {REPORT}")


def main() -> int:
    if sys.argv[1:] not in ([], ["--session-only"]):
        print("Usage: python3 riwi-safari-smoke.py [--session-only]")
        return 2
    session_only = sys.argv[1:] == ["--session-only"]
    report = {"kind": "Safari authenticated API smoke", "commit": COMMIT,
              "origin": ORIGIN, "time": datetime.now(timezone(timedelta(hours=5))).isoformat(),
              "checks": [], "state": "blocked", "fullAcceptance": False,
              "authentication": "existing_safari_session" if session_only else "native_password_login",
              "browserVisualQA": "not_performed", "modelTrainingValidated": False}
    try:
        if not sys.stdin.isatty():
            raise SmokeBlocked("run_interactively_in_terminal")
        print("Safari oldingi oynasida shu preview saytini ochiq qoldiring:")
        print(ORIGIN + "/login")
        window_id = int(applescript('tell application "/Applications/Safari.app" to get id of front window'))
        current = applescript('tell application "/Applications/Safari.app" to get URL of current tab of window id ' + str(window_id))
        url = urlsplit(current)
        if f"{url.scheme}://{url.netloc}" != ORIGIN:
            raise SmokeBlocked("open_exact_preview_in_safari_first")
        public = request(window_id, "/api/frontend/public")
        report["checks"].append(public)
        if public.get("status") != 200 or not public.get("passwordEnabled"):
            raise SmokeBlocked("preview_protection_or_public_config_unavailable")
        if not session_only:
            password = getpass.getpass("QA Owner paroli (ekranda ko‘rinmaydi): ")
            if not password:
                raise SmokeBlocked("password_not_entered")
            login = request(window_id, "/api/auth/login", password=password)
            password = ""
            report["checks"].append(login)
            print("Login HTTP:", login.get("status"))
            if login.get("status") != 200:
                raise SmokeBlocked("native_login_failed_no_retry")
        session = request(window_id, "/api/frontend/session")
        report["checks"].append(session)
        if session.get("status") != 200 or not all(session.get(key) for key in ("owner", "active", "expectedAccount")):
            raise SmokeBlocked("expected_owner_session_not_confirmed")
        print("Owner sessiyasi: tasdiqlandi")
        for path in READS[2:]:
            result = request(window_id, path)
            report["checks"].append(result)
            print(path, "HTTP", result.get("status"), result.get("error", ""), result.get("reason", ""))
        report["state"] = ("api_smoke_passed" if all(row.get("status") == 200 for row in report["checks"])
                           else "api_failures_observed")
    except SmokeBlocked as exc:
        report["blocker"] = str(exc)
        print("To‘xtadi:", str(exc))
    except (ValueError, OSError, KeyboardInterrupt, EOFError):
        report["blocker"] = "local_runner_failed_or_cancelled"
        print("Mahalliy test bajarilmadi yoki bekor qilindi.")
    finally:
        write_report(report)
    return 0 if report["state"] == "api_smoke_passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
