# Tourgrid Studio API v1

FastAPI 同时提供同源前端：

- `GET /`：编辑器页面
- `GET /static/*`：前端 CSS 和 JavaScript 静态资源

第二阶段提供 FastAPI 服务，默认监听 `127.0.0.1:8000`。Swagger UI 位于 `/docs`，OpenAPI 文档位于 `/openapi.json`。

## 转换器版本

- `1.1.0`：透明 PNG 只使用非透明 RGB 样本拟合颜色模型，保留原 alpha 蒙版，
  避免 Pyxelate 2.1.1 的 RGBA 拟合性能问题和透明区域伪色。
- `1.0.0`：初始直接映射版本。

## 启动

```powershell
.\.venv\Scripts\tourgrid-api.exe
```

开发时也可以直接运行 Uvicorn：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.api.app:app --reload
```

## 接口

### `GET /api/v1/health`

返回服务状态、转换器版本和默认色板 ID。

### `GET /api/v1/palettes`

返回当前可用的版本化色板摘要。

### `GET /api/v1/palettes/{palette_id}`

返回色板元数据和全部颜色。不存在的色板返回 `404 palette_not_found`。

### `POST /api/v1/convert`

请求类型是 `multipart/form-data`。

字段：

| 字段 | 默认值 | 限制 |
|---|---:|---|
| `image` | 必填 | PNG、JPEG 或 WebP |
| `width` | 24 | 8～128 |
| `height` | 24 | 8～128 |
| `palette_id` | `natural-64-v1` | 已注册色板 |
| `dither` | `none` | `none`、`naive`、`bayer`、`floyd`、`atkinson` |
| `sobel` | 3 | 2～9 |
| `depth` | 1 | 1～3 |
| `fit` | `crop` | `crop`、`stretch` |
| `mapping_mode` | `direct` | `direct`、`two-stage` |
| `auto_colors` | 18 | 2～64，仅实验模式使用 |
| `cleanup_passes` | 2 | 0～4，仅实验模式使用 |
| `cleanup_delta_e` | 14 | 0～100，仅实验模式使用 |
| `svd` | `true` | 布尔值 |
| `converter_version` | `1.1.0` | 必须与服务器版本一致 |

示例：

```powershell
curl.exe -X POST http://127.0.0.1:8000/api/v1/convert `
  -F "image=@sample.png;type=image/png" `
  -F "width=24" `
  -F "height=24" `
  -F "palette_id=natural-64-v1" `
  -F "dither=none"
```

成功响应：

```json
{
  "width": 24,
  "height": 24,
  "paletteId": "natural-64-v1",
  "paletteVersion": 1,
  "converterVersion": "1.1.0",
  "usedColors": 28,
  "usedColorIds": ["N01", "N07"],
  "pixels": [["N07", "N07"]],
  "hexPixels": [["#EAE6DE", "#EAE6DE"]],
  "previewUrl": "/api/v1/results/0123456789abcdef0123456789abcdef/preview.png",
  "mappingMode": "direct",
  "learnedColors": null,
  "cleanupChanges": 0
}
```

完全透明的像素在两个矩阵中都表示为 `null`。

### `GET /api/v1/results/{result_id}/preview.png`

返回最近邻放大的 PNG 预览。预览只保存在当前 API 进程的有界内存缓存中，默认五分钟后过期；用户上传的原始图片不会写入磁盘。

## 默认安全限制

- 上传文件最大 10 MiB；
- 解码图片宽高最大 8192×8192；
- 解码图片最大 2500 万像素；
- 不接受动画图片；
- MIME 必须是受支持的图片类型，并与真实解码格式一致；
- 单次转换默认最多 30 秒；
- 单个 API 进程最多同时执行两个转换；
- 等待转换槽位默认最多两秒；
- 预览缓存最多 128 项，TTL 为 300 秒。

转换任务在独立子进程运行。超时后服务会终止该子进程，不会让已经超时的 Pyxelate 任务继续占用计算资源。

## 环境变量

所有限制均可在部署时覆盖：

```text
TOURGRID_MAX_UPLOAD_BYTES
TOURGRID_MAX_IMAGE_WIDTH
TOURGRID_MAX_IMAGE_HEIGHT
TOURGRID_MAX_IMAGE_PIXELS
TOURGRID_MIN_OUTPUT_SIZE
TOURGRID_MAX_OUTPUT_SIZE
TOURGRID_PROCESSING_TIMEOUT_SECONDS
TOURGRID_QUEUE_TIMEOUT_SECONDS
TOURGRID_MAX_CONCURRENT_CONVERSIONS
TOURGRID_PREVIEW_SCALE
TOURGRID_PREVIEW_TTL_SECONDS
TOURGRID_PREVIEW_CACHE_ENTRIES
```

## 错误格式

API 自身产生的错误使用统一结构：

```json
{
  "error": {
    "code": "invalid_image",
    "message": "The uploaded file is not a valid supported image."
  }
}
```

参数验证错误还会包含 `details` 数组。
