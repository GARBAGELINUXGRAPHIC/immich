FROM ghcr.io/immich-app/immich-machine-learning@sha256:5b28c9352c8374b8a1ed96fbdd8d6755fea6e43510ec43fdf6538aa02ea40f56

LABEL org.opencontainers.image.title="Immich ML with bundled OCR and face models"

COPY --from=ml_weights /facial-recognition/buffalo_l/detection/model.onnx /cache/facial-recognition/buffalo_l/detection/
COPY --from=ml_weights /facial-recognition/buffalo_l/recognition/model.onnx /cache/facial-recognition/buffalo_l/recognition/
COPY --from=ml_weights /ocr/PP-OCRv5_server/detection/model.onnx /cache/ocr/PP-OCRv5_server/detection/
COPY --from=ml_weights /ocr/PP-OCRv5_server/recognition/model.onnx /cache/ocr/PP-OCRv5_server/recognition/
RUN --network=none cd /cache && printf '%s\n' \
    '5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91  facial-recognition/buffalo_l/detection/model.onnx' \
    '6afbf406aa229a439abbca7436cc42be254d4e3af6200d8b7ae4c1fec0c18f2f  facial-recognition/buffalo_l/recognition/model.onnx' \
    '0f8846b1d4bba223a2a2f9d9b44022fbc22cc019051a602b41a7fda9667e4cad  ocr/PP-OCRv5_server/detection/model.onnx' \
    'e09385400eaaaef34ceff54aeb7c4f0f1fe014c27fa8b9905d4709b65746562a  ocr/PP-OCRv5_server/recognition/model.onnx' \
    | sha256sum --check

ENV HF_HUB_OFFLINE=1
