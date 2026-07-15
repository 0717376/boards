#!/bin/sh
# Seed ~/.claude.json from the read-only mount (the CLI wants to write to it);
# OAuth creds live in the mounted ~/.claude dir, token refresh persists there.
if [ -f /seed/.claude.json ]; then
  cp -f /seed/.claude.json /root/.claude.json
fi

exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
