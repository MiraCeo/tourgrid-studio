# Tourgrid Studio API v1

FastAPI提供版本化色板查询与不可变作品分享，并在本地开发时提供同源前端：

- `GET /`：编辑器页面
- `GET /static/*`：前端静态资源
- `/docs`：Swagger UI
- `/openapi.json`：OpenAPI文档

服务器不接收用户图片。图片裁切、官方色板转换和参考图保存均在浏览器本地完成。

## 启动

在源码仓库根目录运行：

```powershell
.\.venv\Scripts\python.exe -m backend
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
  "appVersion": "0.3.2",
  "defaultPaletteId": "official-40-v1"
}
```

该接口是进程存活检查，不访问PostgreSQL或Redis。

## `GET /api/v1/ready`

检查作品数据库和共享状态服务是否可用。Docker健康检查及Caddy上游主动检查使用
该接口。依赖全部正常时返回：

```json
{
  "status": "ready",
  "database": "ok",
  "sharedState": "ok"
}
```

PostgreSQL或Redis不可用时返回503。未配置数据库的本地纯前端源码运行也会返回
`503 database_not_ready`，这是预期行为。

## `GET /api/v1/palettes`

返回可用色板的ID、名称、版本、状态和颜色数量。

## `GET /api/v1/palettes/{palette_id}`

返回色板元数据和全部颜色。不存在时返回 `404 palette_not_found`。

已经发布的色板不能被同ID的新内容覆盖。

## `POST /api/v1/works`

匿名保存不可变的24×24作品。浏览器按照色板颜色顺序将每格编码为6位索引，
每4格打包为3字节，最终得到严格432字节；JSON请求中使用Base64传输。

```json
{
  "schemaVersion": 1,
  "paletteId": "official-40-v1",
  "paletteVersion": 1,
  "pixels": "<长度576的Base64字符串>",
  "title": "作品标题",
  "authorName": "作者名称"
}
```

约束：

- `schemaVersion` 当前必须为 `1`。
- 色板必须存在、版本匹配且包含1至64种颜色；当前默认色板为40种官方颜色。
- Base64解码后必须严格为432字节。
- 每个6位索引必须落在所选色板的颜色范围内。
- `title` 和 `authorName` 可选，去除首尾空白后最长15个字符。
- 空标题或作者按未填写处理。

服务器只以“编码版本、色板ID、色板版本和像素数据”的完整SHA-256去重。
相同作品始终返回同一个12位Base58分享码；标题与作者只在首次保存时写入，
后续提交不能覆盖首次署名。

成功响应：

```json
{
  "code": "7Kp3mXqB4NzR",
  "schemaVersion": 1,
  "paletteId": "official-40-v1",
  "paletteVersion": 1,
  "pixels": "<长度576的Base64字符串>",
  "authorName": "博士",
  "title": "很糊的画",
  "viewCount": 0,
  "createdAt": "2026-07-28T00:00:00Z"
}
```

## `GET /api/v1/works/{code}`

凭区分大小写的12位Base58分享码读取作品。服务端为浏览器设置仅用于匿名计数的
`tourgrid_viewer` Cookie；同一浏览器在默认30分钟窗口内重复读取同一作品只计一次。
去重键只临时保存在Redis中，不写入PostgreSQL。清除Cookie或换用另一浏览器会被
视为新的浏览会话，因此这是近似浏览次数，不是唯一人数统计。
作品不包含用户原图、本地参考图或导出的PNG。

可能错误：

- `404 work_not_found`：分享码对应的作品不存在。
- `404 work_hidden`：作品已隐藏，消息中包含公开的处理原因。
- `404 work_deleted`：作品已永久删除，消息中包含公开的处理原因。
- `422 request_validation_failed`
- `503 work_storage_unavailable`

## 已移除接口

以下服务器图片转换接口自0.3.0起不存在：

- `POST /api/v1/convert`
- `GET /api/v1/results/{result_id}/preview.png`

客户端不得回退调用这些接口。

## 管理员接口

管理员页面位于 `/admin/`。页面可以分页查看全部正常、隐藏和已清除作品；未永久
清除的作品会返回像素数据并绘制24×24预览。管理员接口使用
`Authorization: Bearer <TOURGRID_ADMIN_TOKEN>`。管理员令牌必须
是至少32字符的独立随机值，不得与 `TOURGRID_DB_PASSWORD` 复用，也不要写入仓库。
后台只在当前页面内存中保存令牌，刷新或退出后需要重新输入。
管理员认证失败按客户端IP记录在Redis临时键中：默认15分钟内累计5次失败后返回
`429 admin_auth_rate_limited` 和 `Retry-After`。正确令牌会清除该IP的失败记录，
避免同一出口IP中的恶意请求把持有正确令牌的管理员永久锁在后台外。

- `GET /api/v1/admin/session`：验证管理员令牌。
- `GET /api/v1/admin/works?status=...&limit=48&cursor=...`：按创建顺序分页读取
  全部作品，可按 `active`、`hidden` 或 `purged` 筛选。
- `GET /api/v1/admin/works/{code}`：读取单个作品的完整管理信息和可用画面。
- `POST /api/v1/admin/works/{code}/hide`：隐藏作品。公共分享码立即返回404，
  内容仍保留并可恢复，相同像素不能重新发布。处理原因会向分享码访问者公开。
- `POST /api/v1/admin/works/{code}/restore`：恢复隐藏作品。永久清除的作品不能恢复。
- `POST /api/v1/admin/works/{code}/purge`：永久清除像素、标题和作者。请求体必须
  同时包含处理原因和完全匹配的 `confirmationCode`。标准化内容哈希墓碑继续保留，
  因此相同像素不能重新发布。
- `GET /api/v1/admin/moderation-events`：分页读取管理操作审计记录。
- `POST /api/v1/admin/bans`：请求体为
  `{"clientIp":"203.0.113.10","reason":"...","ttlSeconds":3600}`。
  有 `ttlSeconds` 时写入Redis临时封禁（60秒至30天）；省略时写入PostgreSQL永久
  封禁。
- `DELETE /api/v1/admin/bans?clientIp=203.0.113.10`：同时移除临时和永久封禁。

若未配置管理员令牌，这些接口返回 `503 admin_not_configured`，不会使用数据库密码
作为后备凭据。

## 限流和请求体

- `POST /api/v1/works` 使用Redis中按客户端IP共享的时间窗口限流。
- Redis还保存临时封禁和浏览去重键；这些数据都带TTL，不作为永久业务数据。
- Caddy默认将请求体限制为128KB。
- API请求ID通过 `X-Request-ID` 返回。
- 未配置Redis的源码单进程运行会使用内存实现；多实例部署必须配置Redis。

相关环境变量：

```text
TOURGRID_RATE_LIMIT_REQUESTS
TOURGRID_RATE_LIMIT_WINDOW_SECONDS
TOURGRID_RATE_LIMIT_MAX_CLIENTS
TOURGRID_DATABASE_URL
TOURGRID_REDIS_URL
TOURGRID_ADMIN_TOKEN
TOURGRID_ADMIN_AUTH_FAILURE_LIMIT
TOURGRID_ADMIN_AUTH_FAILURE_WINDOW_SECONDS
TOURGRID_VIEW_DEDUPE_SECONDS
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
    "message": "该作品不存在。"
  }
}
```

隐藏或删除作品会分别返回 `work_hidden` 或 `work_deleted`，并在 `message` 中附带
管理员填写的处理原因。参数验证错误还会包含 `details` 数组。
