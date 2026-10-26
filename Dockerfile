# Minimal image for MCP directory checks (e.g. Glama): starts the stdio server without config or token.
# initialize/tools/list work; every tool call reports CONFIG until a real config and token are mounted.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY templates ./templates
COPY LICENSE NOTICE README.md ./
USER node
ENTRYPOINT ["node", "src/cli.js", "serve"]
