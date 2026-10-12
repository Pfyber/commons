# All four Commons services in one image; the compose file picks the binary.
FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release --locked --bin api --bin orchestrator --bin zone --bin social \
 && mkdir /out && cp target/release/api target/release/orchestrator target/release/zone target/release/social /out/

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* && useradd --system commons
COPY --from=build /out/ /usr/local/bin/
COPY assets /srv/assets
WORKDIR /srv
ENV COMMONS_MAPS_DIR=/srv/assets/maps \
    COMMONS_SCREEN_PLAYLIST=/srv/assets/screen/playlist.json \
    COMMONS_DEV=false \
    COMMONS_LOG_JSON=true
USER commons
