FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY upstream.lock.json ./
COPY scripts ./scripts
# Download original MF repository at the locked commit and verify archive SHA-256.
RUN npm run upstream:sync && npm ci --prefix upstream/mf --ignore-scripts
COPY src ./src
RUN npm run build && cp upstream/mf/LICENSE dist/LICENSE-MF && npm prune --omit=dev --ignore-scripts

FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f
ENV NODE_ENV=production PORT=3000 KSEF_ENVIRONMENT=production
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /app/package.json /app/upstream.lock.json ./
COPY --from=build --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/src ./src
COPY --from=build --chown=pwuser:pwuser /app/dist ./dist
USER pwuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
