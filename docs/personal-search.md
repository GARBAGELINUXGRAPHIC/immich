# Personal search on a GTX 1660 SUPER (6 GB)

This branch targets Immich **v3.3.5**. Existing iOS, Android and web controls and API payloads are unchanged:

| Existing mode | Behavior |
| --- | --- |
| Search by context / scene | Qwen3-VL-Embedding-2B encodes both the image and the query. |
| Search by filename | Existing filename search. |
| Search by description | Existing saved description/caption metadata search. |
| Search by OCR | Normalized, fuzzy search over recognized visible text, with literal matches first. |
| People | Existing face recognition and person filters. |

No mobile rebuild is needed. Changing the server does not add menu items to installed apps.

## Model and serving

Use Qwen3-VL-Embedding-2B **Q8_0** with its matching **mmproj-Q8_0**, served by llama.cpp **b12110 CUDA 12.4**. The tested setup uses one slot, flash attention, a 2048-token context and at most 1024 image tokens. Older llama.cpp builds without multimodal `/v1/embeddings` support are unsuitable.

Start the native Windows server with `docker/start-qwen-search.ps1`, supplying the paths to `llama-server.exe`, the two GGUF files and a log directory outside the checkout:

```powershell
.\docker\start-qwen-search.ps1 `
  -LlamaServer 'D:\models\llama\llama-server.exe' `
  -Model 'D:\models\Qwen3-VL-Embedding-2B.Q8_0.gguf' `
  -Projector 'D:\models\Qwen3-VL-Embedding-2B.mmproj-Q8_0.gguf' `
  -LogDirectory 'D:\models\qwen-logs'
```

It listens on localhost only. Windows Docker Desktop can reach it at `http://host.docker.internal:28083`; this was checked from the existing Immich container. For another host, configure a reachable private endpoint instead. Optional authentication uses `-ApiKeyFile` and the same key in `IMMICH_QWEN_API_KEY` on the Immich server. Keep keys out of Git.

Wait for `/health` to return 200 and warm up a text embedding before switching models. The first inference can take tens of seconds. Image and text embeddings use the same instruction prompt, last-token pooling and L2 normalization. Images retain the whole frame, apply EXIF orientation and fit within 2048×2048. The adapter rejects wrong dimensions, zero vectors and failed requests; it never substitutes CLIP vectors when Qwen is unavailable.

## Deploy and index

1. Back up the current database using Immich's backup facility. Keep the existing v3.3.5 compose file and image available for rollback.
2. Start Qwen and verify health. Set `IMMICH_FORK_PATH` to this checkout. Build the server with the existing compose file plus `docker/compose.personal-search.yml`:

   ```powershell
   $env:IMMICH_FORK_PATH = (Get-Location).Path
   docker compose -f 'G:\immich\docker-compose.yml' -f '.\docker\compose.personal-search.yml' build immich-server
   docker compose -f 'G:\immich\docker-compose.yml' -f '.\docker\compose.personal-search.yml' up -d --no-deps immich-server
   ```

   These paths are examples for this machine. The override inherits the existing storage, database and ML service. It does not change the mobile API or the database image. Its automatic migration adds a normalized OCR index and backfills **visible original OCR boxes**, leaving recognized text and boxes intact. Photos with no OCR results still need an OCR job.

3. In Administration → Settings → Machine Learning, select `Qwen3-VL-Embedding-2B` for Smart Search. The database must use **VectorChord**: pgvector's HNSW index cannot store this model's 2048 dimensions. The server probes Qwen before replacing an incompatible search index.
4. Set Smart Search job concurrency to **1**. Changing the model invalidates the previous semantic index. In Administration → Jobs, queue **Smart Search: Missing** to rebuild it; existing results are incomplete until it finishes. Do not combine old CLIP vectors with Qwen vectors.
5. For printed and handwritten Chinese/English text, use Immich's existing `PP-OCRv5_server` OCR model, with maximum resolution **2048**, recognition threshold **0.5** as an initial setting, and OCR concurrency **1**. Keep the ordinary CPU ML image for OCR/face processing so it does not compete with Qwen for 6 GB VRAM. This lowers the chance that a slightly misrecognized name is discarded before fuzzy search. Handwriting accuracy still needs testing on personal examples; fuzzy matching cannot recover text the OCR detector never finds.
6. Queue **OCR: All** after changing the OCR model/settings. This recomputes OCR results, including their boxes; review any manually hidden OCR text before a full rerun. A model-free migration alone does not require rerunning OCR.

The [PP-OCRv5 documentation](https://www.paddleocr.ai/v3.0.3/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5.html) describes Chinese/English handwriting support. That does not imply equivalent quality for every handwriting style or language.

## Fuzzy OCR behavior

- Normalize Unicode width, letter case, whitespace and traditional/simplified Chinese only in the search index.
- Require every whitespace-separated query term. For example, `BJUT 2024 黄励文` requires all three.
- Permit one substitution, omission, extra character or adjacent swap for terms of 3–16 characters. One- and two-character terms stay literal to limit false positives; longer terms use trigram word similarity.
- Put assets matching every term literally first; then rank approximate matches by literal terms and similarity, with deterministic date/ID tie-breaking. Explicit structured sort orders take precedence.
- Retain existing ownership, album, visibility and locked-folder rules. Hiding an OCR box also removes it from this index.

Short fuzzy queries can produce extra candidates. Add another word or date to narrow them. Recognition confidence and search similarity are different signals; a low-confidence OCR result is not proof that the text is absent.

## Validation and limits

The implementation has unit tests for Unicode normalization, typo patterns, Qwen payloads, image orientation, malformed vectors and failure handling. Disposable PostgreSQL integration tests exercise old and structured request shapes, literal-first ordering, pagination, permissions, OCR visibility and migration backfill/rollback.

The earlier fixed 256-photo sample included the requested target. Qwen Q8 placed it at ranks **1 / 1 / 5 / 1** for `黄励文`, `BJUT`, `2024`, `BJUT/2024/黄励文`; Jina FP16 gave **131 / 20 / 102 / 5**. These ranks describe that sample only, not the full library. Qwen indexing took about 22.4 minutes; peak device memory was about 4.37 GiB, including desktop use. This is measured evidence for this setup, not a universal comparison between model sizes.

Full-library indexing, handwriting quality, and a rebuilt production container must be verified at deployment. The server build and a live adapter smoke test are separate from deployment. No production migration or full-library reindex is performed by the tests.

## Rollback

Restore the original server image/compose configuration. Use the previous Smart Search model and rebuild its semantic index, or restore the pre-change database backup together with the matching server version. Do not use CLIP queries against Qwen vectors. The additional OCR column/index are additive; the migration's down step removes only those additions and retains OCR boxes and the original search text.
