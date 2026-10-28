# claude-usage

A small mobile web page that shows Claude account usage from CLIProxyAPI.

For every Claude account it shows the percentage used of the 5-hour and weekly
limits with their reset times, and a chart of each window over time. The page is
read-only and loads data when it opens and when you press Refresh.

It is a SvelteKit page (`web/`, static build) embedded in a Go server. The server
serves the page and forwards two calls to a [CLIProxyAPI fork](https://github.com/djosh34/CLIProxyAPI)
with its `history` block enabled:

- `GET /api/usage` goes to the proxy's `GET /usage`
- `GET /api/history` goes to the proxy's `GET /history`

It adds `Authorization: Bearer <history key>` to both and serves nothing else.

## Configuration

Three environment variables, all required:

| Variable | Example | Meaning |
| --- | --- | --- |
| `CLAUDE_USAGE_LISTEN` | `127.0.0.1:8318` | Address the server listens on |
| `CLAUDE_USAGE_PROXY_URL` | `http://127.0.0.1:8317` | Base URL of the proxy |
| `CLAUDE_USAGE_HISTORY_KEY` | | The `key` of the proxy's `history` block |

`claude-usage --version` prints the commit it was built from.

## Build

The Go package embeds `web/build`, so build the page first:

```sh
pnpm -C web install --frozen-lockfile
pnpm -C web build
go test ./...
go build -o claude-usage .
```

The image is a single static binary on scratch:

```sh
docker buildx build --platform linux/amd64,linux/arm64 --build-arg COMMIT=$(git rev-parse HEAD) .
```

Every push to `main` publishes `ghcr.io/djosh34/claude-usage:main-<commit>`.
