# Pack engine — FastAPI/uvicorn. Build context: repo root.
#   docker build -f deploy/engine.Dockerfile -t pack-engine .
#
# Multi-stage: resolve the FULL dependency set from backend/pyproject.toml in a builder, then ship
# a slim non-root runtime. Installing the package itself (`pip install .`) — instead of a hand-copied
# list — is what keeps the image in lockstep with pyproject; a hand list silently drifted before and
# shipped a prod engine missing python-multipart/pypdf/reportlab/… (uploads + Forge broke).

FROM python:3.12-slim AS build
WORKDIR /app
# A dedicated venv we can copy wholesale into the runtime stage.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
# The .dockerignore drops .env/.venv/__pycache__, so this context is clean. pyproject.toml + README
# + app/ are all present, so `pip install .` resolves every [project.dependencies] entry.
COPY backend/ /app/
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

FROM python:3.12-slim
WORKDIR /app
# Non-root runtime user (least privilege).
RUN adduser --system --no-create-home --group pack
COPY --from=build /opt/venv /opt/venv
# App source: app/, schema/ (frozen event schema, loaded at runtime), prompts/, scripts/.
# Secrets are NOT baked in — they arrive via env (.env.prod). .dockerignore drops .env/.venv.
COPY backend/ /app/
ENV PATH="/opt/venv/bin:$PATH"
USER pack
EXPOSE 8000
# Liveness probe so orchestrators/compose can see 'unhealthy' instead of a false 'up'.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
