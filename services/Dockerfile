# Multi-stage image for the CartridgeFi Rust services (core-api, ws-mesh, keeper-bots).
# One compile produces all binaries; CARTRIDGEFI_SERVICE selects which one runs.
# Build context: services/ (see .dockerignore). No keys or secrets are copied in.

FROM rust:1.95-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY core-api ./core-api
COPY ws-mesh ./ws-mesh
COPY keeper-bots ./keeper-bots
RUN cargo build --release --locked --bin cartridge-core-api --bin cartridge-ws-mesh --bin cartridge-keeper-bots

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home cartridge
COPY --from=builder /build/target/release/cartridge-core-api /usr/local/bin/cartridge-core-api
COPY --from=builder /build/target/release/cartridge-ws-mesh /usr/local/bin/cartridge-ws-mesh
COPY --from=builder /build/target/release/cartridge-keeper-bots /usr/local/bin/cartridge-keeper-bots
USER cartridge
ENV CARTRIDGEFI_SERVICE=core-api \
    RUST_LOG=info
EXPOSE 8080
# Cloud Run injects $PORT; map it onto the env var each binary reads.
# keeper-bots has no HTTP listener: run it as a Cloud Run Job (args such as --once pass through).
ENTRYPOINT ["/bin/sh", "-c", "if [ \"$CARTRIDGEFI_SERVICE\" = \"keeper-bots\" ]; then exec /usr/local/bin/cartridge-keeper-bots \"$@\"; elif [ \"$CARTRIDGEFI_SERVICE\" = \"ws-mesh\" ]; then CARTRIDGEFI_WS_PORT=\"${PORT:-8788}\" exec /usr/local/bin/cartridge-ws-mesh; else CARTRIDGEFI_API_PORT=\"${PORT:-8787}\" exec /usr/local/bin/cartridge-core-api; fi", "cartridge"]
