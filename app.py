import email
import html
import imaplib
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr
from functools import wraps
from pathlib import Path
from urllib.parse import urlparse

import requests
from flask import (Flask, jsonify, redirect, render_template, request,
                   session, url_for)
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_wtf.csrf import CSRFError, CSRFProtect
from werkzeug.security import check_password_hash

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("baepass")

# ---------------------------------------------------------------- config
GMAIL_ADDR = os.environ["GMAIL_ADDR"]
GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]
SENDER = os.environ["SENDER"].lower()              # e.g. noreply@yourchatsite.com
ALLOWED_HOST = os.environ["ALLOWED_HOST"].lower()  # e.g. yourchatsite.com
FRIEND_PIN_HASH = os.environ["FRIEND_PIN_HASH"]
STATE_FILE = Path(os.environ.get("STATE_FILE", "processed.json"))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"

CHAT_URL = os.environ.get("CHAT_URL", "")
if not CHAT_URL.startswith("https://"):
    CHAT_URL = ""

MAX_FAILS = 5
LOCK_SECONDS = 15 * 60
THEMES = ("romantic", "minimal")

app = Flask(__name__)
app.secret_key = os.environ["APP_SECRET_KEY"]
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=COOKIE_SECURE,
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
    WTF_CSRF_TIME_LIMIT=None,          # token lives as long as the session
    SEND_FILE_MAX_AGE_DEFAULT=timedelta(days=30),  # static files are versioned
)
CSRFProtect(app)
limiter = Limiter(get_remote_address, app=app, storage_uri="memory://")

# Cache-buster for static files: changes whenever a file changes.
ASSET_V = str(int(max(
    (p.stat().st_mtime for p in Path(app.static_folder).rglob("*") if p.is_file()),
    default=0,
)))


@app.context_processor
def inject_globals():
    return {"asset_v": ASSET_V}


# ---------------------------------------------------------------- helpers
def current_theme():
    t = request.args.get("theme") or request.cookies.get("theme")
    return t if t in THEMES else "romantic"


@app.after_request
def add_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; connect-src 'self'; "
        "style-src 'self' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; img-src 'self' data:; "
        "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    )
    if request.endpoint != "static":
        resp.headers["Cache-Control"] = "no-store"
    theme = request.args.get("theme")
    if theme in THEMES:
        resp.set_cookie("theme", theme, max_age=31536000,
                        samesite="Lax", secure=COOKIE_SECURE)
    return resp


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not session.get("authed"):
            if request.method == "POST":
                return jsonify(ok=False, status="auth"), 401
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapper


@app.errorhandler(429)
def too_many(_e):
    return jsonify(ok=False, status="rate"), 429


@app.errorhandler(CSRFError)
def csrf_failed(_e):
    return jsonify(ok=False, status="csrf"), 400


# ---------------------------------------------------------------- state file
def load_state():
    if not STATE_FILE.exists():
        return {"ids": [], "last_verified": None}
    data = json.loads(STATE_FILE.read_text())
    if isinstance(data, list):               # old format: just a list of ids
        return {"ids": data, "last_verified": None}
    return {"ids": data.get("ids", []), "last_verified": data.get("last_verified")}


def save_state(state):
    state["ids"] = state["ids"][-500:]
    STATE_FILE.write_text(json.dumps(state))


# ---------------------------------------------------------------- mailbox
def get_body(msg):
    parts = msg.walk() if msg.is_multipart() else [msg]
    for part in parts:
        if part.get_content_type() in ("text/plain", "text/html"):
            payload = part.get_payload(decode=True)
            if payload:
                return payload.decode(part.get_content_charset() or "utf-8", errors="ignore")
    return ""


def safe_verify_link(text):
    """First link that is https, on our own host, and looks like a verify link."""
    for raw in re.findall(r"https://[^\s\"'<>]+", text):
        url = html.unescape(raw).rstrip(").,;")
        parsed = urlparse(url)
        if (parsed.hostname and parsed.hostname.lower() == ALLOWED_HOST
                and "verify" in (parsed.path + parsed.query).lower()):
            return url
    return None


def verify_latest():
    """Returns (status, last_verified_iso). status: verified | none | error."""
    state = load_state()
    imap = imaplib.IMAP4_SSL("imap.gmail.com")
    try:
        imap.login(GMAIL_ADDR, GMAIL_APP_PASSWORD)
        imap.select("INBOX")
        _, data = imap.search(None, f'(UNSEEN FROM "{SENDER}")')

        for num in reversed(data[0].split()[-10:]):     # 10 newest unread
            _, msg_data = imap.fetch(num, "(BODY.PEEK[])")  # PEEK: don't mark read
            msg = email.message_from_bytes(msg_data[0][1])
            msg_id = (msg.get("Message-ID") or "").strip()
            sender = parseaddr(msg.get("From", ""))[1].lower()
            if not msg_id or msg_id in state["ids"] or sender != SENDER:
                continue

            link = safe_verify_link(get_body(msg))
            if not link:
                continue

            resp = requests.get(link, timeout=10, allow_redirects=False)
            if not 200 <= resp.status_code < 400:
                log.warning("verify link returned %s", resp.status_code)
                return "error", None

            imap.store(num, "+FLAGS", "\\Seen")
            now = datetime.now(timezone.utc).isoformat()
            state["ids"].append(msg_id)
            state["last_verified"] = now
            save_state(state)
            log.info("verified via message %s at %s", msg_id, now)
            return "verified", now

        return "none", None
    finally:
        try:
            imap.logout()
        except Exception:
            pass


# ---------------------------------------------------------------- PIN state
_auth_lock = threading.Lock()
_verify_lock = threading.Lock()
_fails = 0
_locked_until = 0.0


def lock_remaining():
    return max(0, int(_locked_until - time.time() + 0.999))


# ---------------------------------------------------------------- routes
@app.route("/login", methods=["GET", "POST"])
@limiter.limit("20 per minute", methods=["POST"])
def login():
    global _fails, _locked_until

    if request.method == "GET":
        if session.get("authed"):
            return redirect(url_for("index"))
        return render_template("login.html", theme=current_theme(),
                               locked_for=lock_remaining())

    pin = str((request.get_json(silent=True) or {}).get("pin", ""))
    with _auth_lock:
        wait = lock_remaining()
        if wait:
            return jsonify(ok=False, status="locked", seconds=wait), 423

        if re.fullmatch(r"\d{4}", pin) and check_password_hash(FRIEND_PIN_HASH, pin):
            _fails = 0
            session.clear()
            session["authed"] = True
            session.permanent = True
            return jsonify(ok=True)

        _fails += 1
        if _fails >= MAX_FAILS:
            _fails = 0
            _locked_until = time.time() + LOCK_SECONDS
            return jsonify(ok=False, status="locked", seconds=LOCK_SECONDS), 423
        return jsonify(ok=False, status="wrong", left=MAX_FAILS - _fails), 401


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify(ok=True)


@app.route("/")
@login_required
def index():
    return render_template("index.html", theme=current_theme(),
                           last_verified=load_state().get("last_verified") or "",
                           chat_url=CHAT_URL)


@app.route("/verify", methods=["POST"])
@login_required
@limiter.limit("6 per minute")
def verify():
    if not _verify_lock.acquire(blocking=False):   # another press is in flight
        return jsonify(status="busy"), 409
    try:
        status, last = verify_latest()
        return jsonify(status=status, last_verified=last)
    except Exception:
        log.exception("verification failed")
        return jsonify(status="error"), 502
    finally:
        _verify_lock.release()


if __name__ == "__main__":
    # Bind to a private address only (e.g. your Tailscale IP), never 0.0.0.0
    app.run(host=os.environ.get("BIND_HOST", "127.0.0.1"), port=5000, debug=False)
