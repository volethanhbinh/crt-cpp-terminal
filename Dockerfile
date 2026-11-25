FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    g++ \
    gdb \
    binutils \
    util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 10001 -s /bin/bash crtuser

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public

RUN chown -R crtuser:crtuser /app

USER crtuser

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["node", "server.js"]
