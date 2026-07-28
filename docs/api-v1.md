# Tourgrid Studio API v1

FastAPI提供版本化色板查询与不可变作品分享，并在本地开发时提供同源前端：

- `GET /`：编辑器页面
- `GET /static/*`：前端静态资源
- `/docs`：Swagger UI
- `/openapi.json`：OpenAPI文档

服务器不接收用户图片。图片裁切、64色转换和参考图保存均在浏览器本地完成。

## 启动

```powershell
.\.venv\Scripts\tourgrid-api.exe
```

开发模式：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.api.app:app --reload
```

## `GET /api/v1/health`

返回应用状态、应用版本和默认色板：

```json
{
  "status": "ok",
  "appVersion": "0.3.1",
  "defaultPaletteId": "natural-64-v1"
}
```

## `GET /api/v1/palettes`

返回可用色板的ID、名称、版本、状态和颜色数量。

## `GET /api/v1/palettes/{palette_id}`

返回色板元数据和全部颜色。不存在时返回 `404 palette_not_found`。

已经发布的色板不能被同ID的新内容覆盖。

## `POST /api/v1/works`

匿名保存不可变的24×24作品。浏览器按照64色色板顺序将每格编码为6位索引，
每4格打包为3字节，最终得到严格432字节；JSON请求中使用Base64传输。

```json
{
  "schemaVersion": 1,
  "paletteId": "natural-64-v1",
  "paletteVersion": 1,
  "pixels": "<长度576的Base64字符串>",
  "title": "作品标题",
  "authorName": "作者名称"
}
```

约束：

- `schemaVersion` 当前必须为 `1`。
- 色板必须存在、版本匹配且恰好包含64色。
- Base64解码后必须严格为432字节。
- `title` 和 `authorName` 可选，去除首尾空白后最长10个字符。
- 空标题或作者按未填写处理。

服务器只以“编码版本、色板ID、色板版本和像素数据”的完整SHA-256去重。
相同作品始终返回同一个12位Base58分享码；标题与作者只在首次保存时写入，
后续提交不能覆盖首次署名。

成功响应：

```json
{
  "code": "7Kp3mXqB4NzR",
  "schemaVersion": 1,
  "paletteId": "natural-64-v1",
  "paletteVersion": 1,
  "pixels": "<长度576的Base64字符串>",
  "authorName": "博士",
  "title": "很糊的画",
  "viewCount": 0,
  "createdAt": "2026-07-28T00:00:00Z"
}
```

## `GET /api/v1/works/{code}`

凭区分大小写的12位Base58分享码读取作品。每次成功读取会原子增加浏览次数。
作品不包含用户原图、本地参考图或导出的PNG。

可能错误：

- `404 work_not_found`
- `422 request_validation_failed`
- `503 work_storage_unavailable`

## 已移除接口

以下服务器图片转换接口自0.3.0起不存在：

- `POST /api/v1/convert`
- `GET /api/v1/results/{result_id}/preview.png`

客户端不得回退调用这些接口。

## 限流和请求体

- `POST /api/v1/works` 使用按客户端IP的进程内滑动窗口限流。
- Caddy默认将请求体限制为128KB。
- API请求ID通过 `X-Request-ID` 返回。
- 多实例部署前应把限流迁移到Redis等共享服务。

相关环境变量：

```text
TOURGRID_RATE_LIMIT_REQUESTS
TOURGRID_RATE_LIMIT_WINDOW_SECONDS
TOURGRID_RATE_LIMIT_MAX_CLIENTS
TOURGRID_DATABASE_URL
TOURGRID_ENVIRONMENT
TOURGRID_RELEASE
TOURGRID_SENTRY_DSN
TOURGRID_SENTRY_TRACES_SAMPLE_RATE
```

## 错误格式

```json
{
  "error": {
    "code": "work_not_found",
    "message": "Shared work does not exist."
  }
}
```

参数验证错误还会包含 `details` 数组。
