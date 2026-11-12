# Immich Personal Search Docker bundle

Linux amd64. The server is based on Immich v3.3.5. The Qwen container includes
llama.cpp CUDA b12110, Qwen3-VL-Embedding-2B Q8_0, and its Q8_0 vision
projector. The CPU ML container includes PP-OCRv5_server and buffalo_l.
Both model containers run on a Compose network with no internet route.

## Install from the image bundle

1. Load the image archive with `docker load -i immich-personal-search-v3.3.5-quitsense.1.tar`.
2. Copy `.env.example` to `.env` and set `DB_PASSWORD`.
3. From this directory, run `docker compose up -d --wait`.
4. Open `http://localhost:2285` and set up the Immich admin account.

Compose uses local images. Enable NVIDIA GPU access for Docker on the host
(NVIDIA Container Toolkit on Linux, or the WSL 2 backend in Docker Desktop).
Use `IMMICH_PORT` in `.env` to select a different web port.
On the GTX 1660 SUPER, stop the standalone dev Qwen process before starting
this stack so the bundled model has enough GPU memory.

This Compose project starts with its own media and database volumes. The included
`immich.yml` fixes the Smart Search and OCR settings. Edit that file and restart
the server to change Immich system settings. For a restored library indexed by a
different embedding model, rebuild Smart Search using the Qwen model.

## Update the server from Docker Hub

The fork's Docker workflow builds the Linux amd64 server when a commit is pushed
to `quitsense/personal-search`. It publishes a `commit-<full SHA>` image tag when
the fork has a `DOCKERHUB_USERNAME` Actions variable and a `DOCKERHUB_TOKEN`
Actions secret. Use the Docker ID as the username and a Docker Hub access token
with Read & Write access. After configuring credentials, rerun the workflow.

In your existing bundle directory, put `compose.dockerhub.yml` beside `compose.yml`
and set `IMMICH_SERVER_IMAGE` in the existing `.env` to the image reference from
the Actions summary. Run these commands in the same Compose project:

```sh
docker compose -f compose.yml -f compose.dockerhub.yml pull immich-server
docker compose -f compose.yml -f compose.dockerhub.yml up -d --wait
```

The override selects the server image. The bundled Qwen and ML images and the
existing media and PostgreSQL volumes are used by the same Compose project.

## Rebuild the images

From the repository root, use these commands after setting `QWEN_WEIGHTS` and
`ML_WEIGHTS` to local directories with the files listed below. The examples
use a POSIX shell.

```sh
pnpm --config.verify-deps-before-run=false --filter immich build

docker buildx build --load --platform linux/amd64 \
  --build-arg SOURCE_COMMIT="$(git rev-parse HEAD)" \
  --label 'org.opencontainers.image.title=Immich personal search' \
  --label 'org.opencontainers.image.source=https://github.com/GARBAGELINUXGRAPHIC/immich' \
  -f docker/Dockerfile.personal-search-dev \
  -t immich-personal-search/server:v3.3.5-quitsense.1 .

docker buildx build --load --platform linux/amd64 \
  --build-context "qwen_weights=$QWEN_WEIGHTS" \
  -f docker/personal-search-bundle/Dockerfile.qwen \
  -t immich-personal-search/qwen:2b-q8-b12110 docker/personal-search-bundle

docker buildx build --load --platform linux/amd64 \
  --build-context "ml_weights=$ML_WEIGHTS" \
  -f docker/personal-search-bundle/Dockerfile.ml \
  -t immich-personal-search/ml:v3.3.5-quitsense.1 docker/personal-search-bundle

redis='docker.io/valkey/valkey:8-bookworm@sha256:fea8b3e67b15729d4bb70589eb03367bab9ad1ee89c876f54327fc7c6e618571'
postgres='ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:c44be5f2871c59362966d71eab4268170eb6f5653c0e6170184e72b38ffdf107'
docker pull --platform linux/amd64 "$redis"
docker pull --platform linux/amd64 "$postgres"
docker tag "$redis" immich-personal-search/redis:8-bookworm
docker tag "$postgres" immich-personal-search/postgres:14-vectorchord0.4.3

docker save --output immich-personal-search-v3.3.5-quitsense.1.tar \
  immich-personal-search/server:v3.3.5-quitsense.1 \
  immich-personal-search/qwen:2b-q8-b12110 \
  immich-personal-search/ml:v3.3.5-quitsense.1 \
  immich-personal-search/redis:8-bookworm \
  immich-personal-search/postgres:14-vectorchord0.4.3
```

The Qwen context needs `Qwen3-VL-Embedding-2B.Q8_0.gguf` and
`Qwen3-VL-Embedding-2B.mmproj-Q8_0.gguf` from
[mradermacher/Qwen3-VL-Embedding-2B-GGUF](https://huggingface.co/mradermacher/Qwen3-VL-Embedding-2B-GGUF).
The ML context uses these files from the Immich model cache:

- `facial-recognition/buffalo_l/detection/model.onnx`
- `facial-recognition/buffalo_l/recognition/model.onnx`
- `ocr/PP-OCRv5_server/detection/model.onnx`
- `ocr/PP-OCRv5_server/recognition/model.onnx`

The model Dockerfiles verify each file's SHA-256 during the build.
