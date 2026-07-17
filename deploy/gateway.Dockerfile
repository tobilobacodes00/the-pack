# Pack gateway — Rust/Axum read-only WS fan-out. Build context: repo root.
# Multi-stage: compile in the Rust image, ship a slim runtime. gateway/ is never modified.
#   docker build -f deploy/gateway.Dockerfile -t pack-gateway .
FROM rust:1-slim AS build
WORKDIR /src
COPY gateway/Cargo.toml gateway/Cargo.lock ./
COPY gateway/src ./src
RUN cargo build --release --locked

# Pinned to bookworm: Debian 13 (trixie) slim dropped `adduser` from the base image, which broke the
# floating `stable-slim` tag. `adduser` is installed explicitly below regardless, so this is belt +
# suspenders — the pin keeps the runtime stable, the package guarantees the command exists.
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl adduser \
    && rm -rf /var/lib/apt/lists/* \
    && adduser --system --no-create-home --group pack
COPY --from=build /src/target/release/pack-gateway /usr/local/bin/pack-gateway
USER pack
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1
# Reads REDIS_URL + GATEWAY_PORT from the environment (see env_file in the compose).
CMD ["pack-gateway"]
