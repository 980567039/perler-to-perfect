#!/usr/bin/env python3
"""JSON service wrapper for the ``perfect-pixel`` Python package.

The browser sends a base64 data URL and receives a sampled RGB PNG.  Alpha is
returned separately as one byte per output cell so transparent margins do not
get turned into opaque white pixels by the RGB-only perfect-pixel algorithm.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import math
import sys
from contextlib import redirect_stdout
from typing import Any, Dict, Optional, Tuple


MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_GRID_DIMENSION = 512
SUPPORTED_MIME_TYPES = {
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/jpg": "JPEG",
    "image/webp": "WEBP",
}
SUPPORTED_SAMPLE_METHODS = {"center", "median", "majority"}


class ServiceError(Exception):
    """An expected failure with a stable machine-readable code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def emit(payload: Dict[str, Any]) -> None:
    """Write exactly one compact JSON document to stdout."""

    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.flush()


def _require_dependencies() -> Tuple[Any, Any, Any]:
    try:
        import numpy as np
        from PIL import Image
        from perfect_pixel import get_perfect_pixel
    except ImportError as exc:
        raise ServiceError(
            "missing-dependency",
            "Perfect Pixel 服务缺少 Python 依赖，请运行 python3 -m pip install -r requirements.txt",
        ) from exc
    return np, Image, get_perfect_pixel


def decode_data_url(value: Any) -> Tuple[bytes, str]:
    if not isinstance(value, str) or not value:
        raise ServiceError("invalid-parameters", "image 必须是 PNG、JPEG 或 WebP data URL")

    try:
        header, encoded = value.split(",", 1)
    except ValueError as exc:
        raise ServiceError("invalid-parameters", "image 不是有效的 data URL") from exc

    header_parts = header.split(";")
    if len(header_parts) < 2 or header_parts[0].lower()[:5] != "data:":
        raise ServiceError("invalid-parameters", "image 不是有效的 data URL")
    mime_type = header_parts[0][5:].lower()
    if mime_type not in SUPPORTED_MIME_TYPES:
        raise ServiceError("invalid-parameters", "仅支持 PNG、JPEG 和 WebP data URL")
    if not any(part.lower() == "base64" for part in header_parts[1:]):
        raise ServiceError("invalid-parameters", "image data URL 必须使用 base64 编码")
    if not encoded:
        raise ServiceError("invalid-parameters", "image data URL 不能为空")

    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ServiceError("invalid-parameters", "image 不是有效的 base64 数据") from exc
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        raise ServiceError("invalid-parameters", "输入图片不能超过 25 MB")
    return image_bytes, SUPPORTED_MIME_TYPES[mime_type]


def parse_grid_size(value: Any) -> Optional[Tuple[int, int]]:
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ServiceError("invalid-parameters", "gridSize 必须是 [列数, 行数]")

    dimensions = []
    for dimension in value:
        if isinstance(dimension, bool) or not isinstance(dimension, int):
            raise ServiceError("invalid-parameters", "gridSize 的列数和行数必须是整数")
        if dimension < 1 or dimension > MAX_GRID_DIMENSION:
            raise ServiceError("invalid-parameters", "gridSize 的每一维必须在 1 到 512 之间")
        dimensions.append(dimension)
    return dimensions[0], dimensions[1]


def parse_options(payload: Dict[str, Any]) -> Tuple[str, Optional[Tuple[int, int]], float, bool]:
    sample_method = payload.get("sampleMethod", "majority")
    if not isinstance(sample_method, str) or sample_method not in SUPPORTED_SAMPLE_METHODS:
        raise ServiceError("invalid-parameters", "sampleMethod 必须是 center、median 或 majority")

    grid_size = parse_grid_size(payload.get("gridSize"))

    refine_value = payload.get("refineIntensity", 0.25)
    if isinstance(refine_value, bool):
        raise ServiceError("invalid-parameters", "refineIntensity 必须是 0 到 0.5 之间的数字")
    try:
        refine_intensity = float(refine_value)
    except (TypeError, ValueError) as exc:
        raise ServiceError("invalid-parameters", "refineIntensity 必须是 0 到 0.5 之间的数字") from exc
    if not math.isfinite(refine_intensity):
        raise ServiceError("invalid-parameters", "refineIntensity 必须是 0 到 0.5 之间的数字")
    refine_intensity = min(0.5, max(0.0, refine_intensity))

    fix_square = payload.get("fixSquare", True)
    if not isinstance(fix_square, bool):
        raise ServiceError("invalid-parameters", "fixSquare 必须是布尔值")
    return sample_method, grid_size, refine_intensity, fix_square


def _cell_bounds(length: int, count: int, np: Any) -> Any:
    # Rounding the continuous boundaries gives every source pixel to a cell
    # when count <= length, while the sampling helpers below still handle an
    # intentionally finer grid by choosing the nearest source pixel.
    return np.rint(np.linspace(0, length, count + 1)).astype(np.int32)


def _cell_slice(start: int, end: int, length: int, index: int, count: int) -> Tuple[int, int]:
    start = max(0, min(length, int(start)))
    end = max(0, min(length, int(end)))
    if end > start:
        return start, end
    center = int((index + 0.5) * length / count)
    center = max(0, min(max(0, length - 1), center))
    return center, min(length, center + 1)


def _representative(cell: Any, method: str, np: Any) -> Any:
    if method == "center":
        return cell[len(cell) // 2]
    if method == "median":
        return np.median(cell, axis=0)

    # Pixel-art cells normally contain repeated exact colors.  A deterministic
    # mode avoids the random tie-breaking of OpenCV k-means and is a sensible
    # fallback when the optional OpenCV accelerator is not installed.
    colors, counts = np.unique(cell, axis=0, return_counts=True)
    return colors[int(np.argmax(counts))]


def estimate_foreground_component(rgba: Any, np: Any) -> Optional[Tuple[Any, int, Any]]:
    """Approximate mvp's largest foreground component on a small mask."""

    source_height, source_width = rgba.shape[:2]
    step = max(1, int(math.ceil(max(source_width, source_height) / 420)))
    mask_height = max(1, int(math.ceil(source_height / step)))
    mask_width = max(1, int(math.ceil(source_width / step)))
    ys = np.minimum(np.arange(mask_height) * step, source_height - 1)
    xs = np.minimum(np.arange(mask_width) * step, source_width - 1)
    samples = rgba[ys[:, None], xs[None, :]]
    alpha = samples[..., 3].astype(np.float32)
    rgb = samples[..., :3].astype(np.float32)

    edge_points = [
        (0, 0),
        (0, mask_width - 1),
        (mask_height - 1, 0),
        (mask_height - 1, mask_width - 1),
        (min(mask_height - 1, 1), mask_width // 2),
        (max(0, mask_height - 2), mask_width // 2),
    ]
    edge_samples = [
        rgb[row, column]
        for row, column in edge_points
        if alpha[row, column] > 24
    ]
    if not edge_samples:
        # The browser keeps contain-mode letterboxes transparent. Recover a
        # likely source-image background from the visible bounding box rather
        # than treating the whole opaque image inside that box as foreground.
        visible_positions = np.argwhere(alpha > 24)
        if visible_positions.size:
            min_row, min_column = visible_positions.min(axis=0).tolist()
            max_row, max_column = visible_positions.max(axis=0).tolist()
            bbox_points = [
                (min_row, min_column),
                (min_row, max_column),
                (max_row, min_column),
                (max_row, max_column),
                (min_row, (min_column + max_column) // 2),
                (max_row, (min_column + max_column) // 2),
            ]
            edge_samples = [
                rgb[row, column]
                for row, column in bbox_points
                if alpha[row, column] > 24
            ]
    background = (
        np.mean(np.asarray(edge_samples, dtype=np.float32), axis=0)
        if edge_samples
        else None
    )
    if background is not None and len(edge_samples) >= 4:
        edge_colors = np.asarray(edge_samples, dtype=np.float32)
        edge_spread = np.sqrt(
            np.sum((edge_colors - background) ** 2, axis=1)
        )
        # A varied object silhouette is not a trustworthy background sample.
        # Keep alpha-only segmentation for that case, which is safer for a
        # genuinely transparent subject PNG.
        if float(np.max(edge_spread)) > 72:
            background = None
    if background is None:
        # A transparent canvas margin has no meaningful RGB background. In
        # that case alpha is the only reliable foreground signal (important
        # for transparent PNGs and for contain-mode letterboxing).
        foreground = alpha > 24
    else:
        distance = np.sqrt(np.sum((rgb - background) ** 2, axis=2))
        foreground = (alpha > 24) & (distance >= 32)
    visited = np.zeros((mask_height, mask_width), dtype=np.uint8)
    best: list[tuple[int, int]] = []
    directions = (-1, 0, 1)
    for start_y in range(mask_height):
        for start_x in range(mask_width):
            if not foreground[start_y, start_x] or visited[start_y, start_x]:
                continue
            queue = [(start_y, start_x)]
            visited[start_y, start_x] = 1
            component: list[tuple[int, int]] = []
            cursor = 0
            while cursor < len(queue):
                row, column = queue[cursor]
                cursor += 1
                component.append((row, column))
                for row_delta in directions:
                    for column_delta in directions:
                        if row_delta == 0 and column_delta == 0:
                            continue
                        next_row = row + row_delta
                        next_column = column + column_delta
                        if (
                            next_row < 0
                            or next_row >= mask_height
                            or next_column < 0
                            or next_column >= mask_width
                            or visited[next_row, next_column]
                            or not foreground[next_row, next_column]
                        ):
                            continue
                        visited[next_row, next_column] = 1
                        queue.append((next_row, next_column))
            if len(component) > len(best):
                best = component
    if not best:
        return None
    component_mask = np.zeros((mask_height, mask_width), dtype=np.uint8)
    for row, column in best:
        component_mask[row, column] = 1
    return component_mask, step, background


def sample_to_grid(
    rgba: Any,
    width: int,
    height: int,
    method: str,
    np: Any,
    foreground: Optional[Tuple[Any, int, Any]] = None,
) -> Tuple[Any, Any]:
    source_height, source_width = rgba.shape[:2]
    x_bounds = _cell_bounds(source_width, width, np)
    y_bounds = _cell_bounds(source_height, height, np)
    rgb = rgba[..., :3].astype(np.float32)
    alpha = rgba[..., 3].astype(np.float32)
    composited = np.rint(rgb * (alpha[..., None] / 255.0) + 255.0 * (1.0 - alpha[..., None] / 255.0))

    sampled = np.empty((height, width, 3), dtype=np.uint8)
    sampled_alpha = np.empty((height, width), dtype=np.uint8)
    for row in range(height):
        y0, y1 = _cell_slice(y_bounds[row], y_bounds[row + 1], source_height, row, height)
        for column in range(width):
            x0, x1 = _cell_slice(x_bounds[column], x_bounds[column + 1], source_width, column, width)
            cell = composited[y0:y1, x0:x1].reshape(-1, 3)
            sampled[row, column] = np.clip(np.rint(_representative(cell, method, np)), 0, 255).astype(np.uint8)
            if foreground is None:
                coverage = alpha[y0:y1, x0:x1].mean()
            else:
                component_mask, step, background = foreground
                source_rgb = rgb[y0:y1, x0:x1]
                source_alpha = alpha[y0:y1, x0:x1]
                mask_rows = np.minimum(
                    component_mask.shape[0] - 1,
                    np.arange(y0, y1) // step,
                )
                mask_columns = np.minimum(
                    component_mask.shape[1] - 1,
                    np.arange(x0, x1) // step,
                )
                component_pixels = component_mask[mask_rows[:, None], mask_columns[None, :]] > 0
                visible = (source_alpha > 24) & component_pixels
                if background is not None:
                    distance = np.sqrt(np.sum((source_rgb - background) ** 2, axis=2))
                    visible &= distance >= 32
                if visible.any():
                    visible_rgb = source_rgb[visible]
                    sampled[row, column] = np.clip(
                        np.rint(_representative(visible_rgb, method, np)), 0, 255
                    ).astype(np.uint8)
                coverage = visible.mean()
            sampled_alpha[row, column] = np.uint8(np.clip(np.rint(coverage * 255), 0, 255))
    return sampled, sampled_alpha


def merge_foreground_sampling(
    refined: Any,
    rgba: Any,
    width: int,
    height: int,
    method: str,
    np: Any,
    foreground: Optional[Tuple[Any, int, Any]],
) -> Tuple[Any, Any]:
    """Keep Perfect Pixel's grid result, but fix mixed foreground cells.

    Perfect Pixel is still authoritative for the grid-aligned RGB result. At
    the silhouette boundary, however, its representative can include the
    white/transparent background. mvp averages only foreground samples there,
    so replace only partially covered cells with that foreground-only color.
    """

    sampled_foreground, sampled_alpha = sample_to_grid(
        rgba, width, height, method, np, foreground
    )
    output = np.asarray(refined)[..., :3].copy()
    if foreground is not None:
        partial = sampled_alpha < 255
        output[partial] = sampled_foreground[partial]
    return output, sampled_alpha


def encode_png(image: Any, np: Any, Image: Any) -> str:
    array = np.asarray(image)
    if array.ndim != 3 or array.shape[2] < 3:
        raise ServiceError("grid-detection-failed", "Perfect Pixel 没有返回 RGB 图像")
    array = np.clip(array[..., :3], 0, 255).astype(np.uint8)
    output = io.BytesIO()
    Image.fromarray(array).save(output, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def refine_with_perfect_pixel(
    detector_input: Any,
    grid_size: Tuple[int, int],
    sample_method: str,
    refine_intensity: float,
    fix_square: bool,
    get_perfect_pixel: Any,
    np: Any,
) -> Tuple[int, int, Any]:
    """Run the upstream library while keeping target grid dimensions exact."""

    target_width, target_height = grid_size
    source_height, source_width = detector_input.shape[:2]
    # perfect-pixel's grid_size is source pixels per cell. The API contract is
    # target [columns, rows], so convert the contract value before calling it.
    library_width = source_width / target_width
    library_height = source_height / target_height
    with redirect_stdout(io.StringIO()):
        refined_width, refined_height, refined = get_perfect_pixel(
            detector_input,
            sample_method=sample_method,
            grid_size=(library_width, library_height),
            refine_intensity=refine_intensity,
            fix_square=False,
            debug=False,
        )
    if refined is None or refined_width is None or refined_height is None:
        raise ServiceError("grid-detection-failed", "Perfect Pixel 未返回有效网格")
    refined = np.asarray(refined)[..., :3]
    if refined.ndim == 3 and refined.shape[:2] == (target_height, target_width):
        return target_width, target_height, refined

    # Refinement can produce one extra/missing boundary for non-divisible
    # source dimensions. Keep the public dimensions stable with the same
    # deterministic cell sampler used for the alpha map.
    opaque_rgba = np.concatenate(
        [detector_input, np.full((source_height, source_width, 1), 255, dtype=np.uint8)],
        axis=2,
    )
    sampled, _ = sample_to_grid(opaque_rgba, target_width, target_height, sample_method, np)
    return target_width, target_height, sampled


def process(payload: Any) -> Dict[str, Any]:
    """Process one request and always return a JSON-serializable result."""

    try:
        if not isinstance(payload, dict):
            raise ServiceError("invalid-parameters", "请求体必须是 JSON 对象")
        sample_method, grid_size, refine_intensity, fix_square = parse_options(payload)
        image_bytes, expected_format = decode_data_url(payload.get("image"))
        np, Image, get_perfect_pixel = _require_dependencies()

        try:
            with Image.open(io.BytesIO(image_bytes)) as source:
                if source.format != expected_format:
                    raise ServiceError("invalid-parameters", "data URL 类型与图片内容不一致")
                rgba = np.asarray(source.convert("RGBA"), dtype=np.uint8)
        except ServiceError:
            raise
        except Exception as exc:
            raise ServiceError("invalid-parameters", "image 不是有效的 PNG、JPEG 或 WebP 图片") from exc

        source_height, source_width = rgba.shape[:2]
        if source_width < 1 or source_height < 1:
            raise ServiceError("invalid-parameters", "图片尺寸无效")

        foreground = estimate_foreground_component(rgba, np)
        if grid_size is not None:
            target_width, target_height = grid_size
            rgb = rgba[..., :3].astype(np.float32)
            alpha = rgba[..., 3:4].astype(np.float32) / 255.0
            detector_input = np.rint(rgb * alpha + 255.0 * (1.0 - alpha)).astype(np.uint8)
            try:
                _, _, sampled = refine_with_perfect_pixel(
                    detector_input,
                    (target_width, target_height),
                    sample_method,
                    refine_intensity,
                    fix_square,
                    get_perfect_pixel,
                    np,
                )
            except ServiceError:
                raise
            except Exception as exc:
                raise ServiceError(
                    "grid-detection-failed",
                    "Perfect Pixel 网格精修失败，请降低网格尺寸或改用内置采样",
                ) from exc
            sampled, sampled_alpha = merge_foreground_sampling(
                sampled,
                rgba,
                target_width,
                target_height,
                sample_method,
                np,
                foreground,
            )
        else:
            # perfect-pixel only accepts RGB. Composite transparent pixels on
            # white for its detector/sampler, then attach original alpha below.
            rgb = rgba[..., :3].astype(np.float32)
            alpha = rgba[..., 3:4].astype(np.float32) / 255.0
            detector_input = np.rint(rgb * alpha + 255.0 * (1.0 - alpha)).astype(np.uint8)
            try:
                with redirect_stdout(io.StringIO()):
                    refined_width, refined_height, refined = get_perfect_pixel(
                        detector_input,
                        sample_method=sample_method,
                        grid_size=None,
                        refine_intensity=refine_intensity,
                        fix_square=fix_square,
                        debug=False,
                    )
            except Exception as exc:
                raise ServiceError(
                    "grid-detection-failed",
                    "Perfect Pixel 网格检测失败，请提供 gridSize 或改用内置采样",
                ) from exc
            if refined_width is None or refined_height is None or refined is None:
                raise ServiceError(
                    "grid-detection-failed",
                    "Perfect Pixel 未检测到稳定网格，请提供 gridSize 或改用内置采样",
                )
            target_width, target_height = int(refined_width), int(refined_height)
            if target_width < 1 or target_height < 1 or target_width > MAX_GRID_DIMENSION or target_height > MAX_GRID_DIMENSION:
                raise ServiceError("grid-detection-failed", "Perfect Pixel 检测到的网格尺寸无效")
            sampled = np.asarray(refined)[..., :3]
            if sampled.ndim != 3 or sampled.shape[:2] != (target_height, target_width):
                raise ServiceError("grid-detection-failed", "Perfect Pixel 返回的网格尺寸不一致")
            sampled, sampled_alpha = merge_foreground_sampling(
                sampled,
                rgba,
                target_width,
                target_height,
                sample_method,
                np,
                foreground,
            )

        return {
            "ok": True,
            "engine": "perfect-pixel",
            "version": "0.1.4",
            "width": int(target_width),
            "height": int(target_height),
            "image": encode_png(sampled, np, Image),
            "alpha": base64.b64encode(sampled_alpha.tobytes(order="C")).decode("ascii"),
            "settings": {
                "sampleMethod": sample_method,
                "gridSize": list(grid_size) if grid_size is not None else None,
                "refineIntensity": refine_intensity,
                "fixSquare": fix_square,
            },
        }
    except ServiceError as exc:
        return {"ok": False, "code": exc.code, "error": str(exc)}
    except Exception as exc:
        return {"ok": False, "code": "processing-error", "error": str(exc)}


def main() -> None:
    try:
        raw_payload = sys.stdin.read()
        payload = json.loads(raw_payload or "{}")
        result = process(payload)
    except json.JSONDecodeError:
        result = {"ok": False, "code": "invalid-parameters", "error": "请求体不是有效的 JSON"}
    except Exception as exc:
        result = {"ok": False, "code": "processing-error", "error": str(exc)}
    emit(result)


if __name__ == "__main__":
    main()
