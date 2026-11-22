# syntax=docker/dockerfile:1
#
# Trabajador de medios: Node + FFmpeg (+ onnxruntime-node y el modelo BEN2 para «Quitar el
# fondo»). No depende de ningún alojamiento: es un contenedor que arranca, vacía la cola y
# termina (o se queda sondeando con WORKER_MODE=continuous).
#
#   docker build -t rrss-worker worker/                       # imagen de ejecución
#   docker build --target test -t rrss-worker-test worker/    # imagen con las pruebas
#
# Node ejecuta el TypeScript tal cual (eliminación de tipos, Node >= 22.18):
# no hay paso de compilación ni carpeta dist.
#
# Base Debian (glibc) y no Alpine: onnxruntime-node solo publica binarios para glibc y en musl
# no carga. FFmpeg y ffprobe son los de Debian (trixie, 7.1), usados como binarios externos.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-trixie-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV WORKER_FONT_FILE=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
    WORKER_TMP_DIR=/tmp/rrss-worker
WORKDIR /app
RUN chown node:node /app
USER node

# ── Pruebas dentro del contenedor (con dependencias de desarrollo) ─────────
FROM base AS test
COPY --chown=node:node package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY --chown=node:node . .
CMD ["npm", "test"]

# ── Dependencias de ejecución ──────────────────────────────────────────────
FROM base AS deps
COPY --chown=node:node package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ── Imagen de ejecución: solo código, plantillas, dependencias y el modelo ─
FROM base AS runtime
ENV NODE_ENV=production
# Modelo BEN2 base fp16 (MIT) de onnx-community/BEN2-ONNX, 219 121 675 bytes, DENTRO de la imagen:
# la máquina se apaga al vaciar la cola y su disco no persiste, así que bajarlo «en el primer
# uso» sería descargar 219 MB en cada arranque (y depender de Hugging Face en cada trabajo).
# La revisión del repositorio y el sha256 están fijados: si el archivo cambia, el build falla.
# (El sha256 es el que Hugging Face da como `lfs.oid` del archivo; se comprobó contra el de la copia local.)
ADD --checksum=sha256:dfdc25f421f32a0d1268e0f2ff2153d340e8f1d52d3dd16f5dc33c1ce85cedf1 --chown=node:node \
    https://huggingface.co/onnx-community/BEN2-ONNX/resolve/c552aa82688edce09f0ac9d2e31ad53d9d629010/onnx/model_fp16.onnx \
    /app/models/ben2-base-fp16.onnx
ENV WORKER_CUTOUT_MODEL=/app/models/ben2-base-fp16.onnx
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node templates ./templates
# Usuario sin privilegios (el `node` de la imagen oficial, uid 1000).
USER node
CMD ["node", "src/main.ts"]
