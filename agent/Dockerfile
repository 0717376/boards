FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Node.js for the Claude CLI (the Agent SDK drives it under the hood)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl tzdata && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

COPY pyproject.toml uv.lock* ./
RUN uv sync --no-dev || uv sync

COPY app ./app
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV DATA_DIR=/data
EXPOSE 8000

CMD ["./entrypoint.sh"]
