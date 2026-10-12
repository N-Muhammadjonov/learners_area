FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node server.mjs package.json ./
USER node
ENV PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
