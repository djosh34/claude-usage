# The page and its Go server as one static binary on scratch.
#   docker buildx build --platform linux/amd64,linux/arm64 --build-arg COMMIT=<sha> .

FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS web

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /src/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web ./
RUN pnpm build

FROM --platform=$BUILDPLATFORM golang:1.27-bookworm AS builder

WORKDIR /src
COPY go.mod *.go ./
COPY --from=web /src/web/build web/build

ARG TARGETOS
ARG TARGETARCH
ARG COMMIT=none

RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -buildvcs=false \
    -ldflags "-s -w -X 'main.commit=${COMMIT}'" -o /out/claude-usage .

FROM scratch

COPY --from=builder /out/claude-usage /claude-usage

USER 65532:65532
ENTRYPOINT ["/claude-usage"]
