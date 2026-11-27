# BaePass

Private one-button page that verifies a login link from a Gmail inbox.
Romantic and Minimal themes, PIN login with lockout.

## Run
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill it in
set -a; source .env; set +a
python app.py                 # http://127.0.0.1:5000
```

## Production (keep ONE worker: lockout and rate limits live in memory)
```bash
gunicorn -w 1 --threads 4 -b $BIND_HOST:5000 app:app
```

## Notes
- Open `/?theme=minimal` or `/?theme=romantic` once to set the theme cookie.
- Keep it on Tailscale or localhost. Set `COOKIE_SECURE=1` once you serve HTTPS.
- `processed.json` stores used email IDs and the last verified time.
