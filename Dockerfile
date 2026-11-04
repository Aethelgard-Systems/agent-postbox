# Minimal image for MCP directory checks (e.g. Glama): starts the stdio server without config or token.
# initialize/tools/list work; every tool call reports CONFIG until a real config and token are mounted.
FROM node:24-alpine
LABEL org.opencontainers.image.source="https://github.com/Aethelgard-Systems/agent-postbox"
LABEL org.opencontainers.image.licenses="Apache-2.0"
ENV NODE_ENV=production XDG_STATE_HOME=/home/node/.local/state
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY templates ./templates
COPY LICENSE NOTICE README.md ./
USER node
ENTRYPOINT ["node", "src/cli.js", "serve"]
