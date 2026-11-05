# Isolated development deployment

Use `docker/compose.personal-search-dev.yml` for a separate copy of an existing
v3.3.5 installation. It publishes port **2284** by default and uses separate
PostgreSQL, Redis, data and ML cache storage. It does not mount production media.

## Build

Compile the server from this checkout, then build the dev image:

```powershell
pnpm --config.verify-deps-before-run=false --filter immich build
docker --context=default build --progress=plain `
  --build-arg SOURCE_COMMIT=(git rev-parse HEAD) `
  -f docker/Dockerfile.personal-search-dev `
  -t immich-personal-search-dev:v3.3.5 .
```

This dev Dockerfile overlays compiled server JavaScript on the pinned v3.3.5
runtime and installs the pinned OpenCC dependency. It reuses that release's web
application and Linux native dependencies. Recompile before rebuilding. For
changes to the frontend or other dependencies, use the regular full Dockerfile.

## Restore a copy

1. Create a new directory, for example `G:\immich-dev-search`, and copy the dev
   compose file there as `compose.yml`. Create a private `.env` beside it:

   ```dotenv
   IMMICH_DEV_ROOT=G:/immich-dev-search
   IMMICH_DEV_PORT=2284
   DB_USERNAME=postgres
   DB_DATABASE_NAME=immich
   DB_PASSWORD=replace-with-a-new-random-password
   ```

2. Copy the complete production upload directory into the new directory's
   `upload` subdirectory. Use physical copies, not hard links. Take a consistent
   `pg_dump -Fc --no-owner --no-acl` of the production database. When transferring
   that dump through Windows, use binary-safe file I/O rather than a text pipe.

3. Start only the dev database and Redis, then restore the dump into the empty
   dev database with `pg_restore --no-owner --no-acl --exit-on-error`. Run a final
   incremental media copy after the snapshot and check that all database file
   paths resolve in the copied media tree.

4. Before starting the copied server, disable SMTP, OAuth auto-login and external
   library scan/watch in its copied configuration. Clear `server.externalDomain`
   and set a visible development login message. Keep the copied user accounts.
   Set the Qwen and OCR settings described in [personal-search.md](personal-search.md),
   with Smart Search and OCR concurrency 1. Keep the face settings unchanged.

5. Start Qwen with `docker/start-qwen-search.ps1`, then start the dev stack:

   ```powershell
   docker compose --project-directory G:\immich-dev-search `
     -f G:\immich-dev-search\compose.yml up -d
   ```

6. Open `http://localhost:2284` or the host's LAN address on port 2284, using the
   copied account credentials. Run Smart Search **Missing** to populate the new
   index and OCR **All** to apply the new OCR model. Results remain incomplete
   while those jobs run. Existing iOS/Android clients use the same API.

## Operations

Use the same `--project-directory` and `-f` arguments with `ps`, `logs`, `stop`
or `up -d`. Do not use `down -v` unless you intend to discard the dev database.
The Qwen process is native Windows and must be started separately after a reboot.
The production stack on port 2283 is independent of this compose project.
