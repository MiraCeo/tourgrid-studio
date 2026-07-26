# 第五阶段：部署与发布

本阶段交付的是一套同源部署方案：

```text
浏览器 -> Caddy (:80/:443) -> 静态前端
                         \-> /api、/docs、/openapi.json -> FastAPI (:8000)
```

FastAPI 容器不向宿主机发布端口，只允许 Caddy 通过 Compose 内部网络访问。
这也是 API 容器可安全信任代理头的前提；不要额外为 `api` 服务添加公开的
`ports` 映射。

## 本地容器验收

复制示例配置并启动：

```powershell
Copy-Item deploy/.env.example deploy/local.env
docker compose --env-file deploy/local.env config
docker compose --env-file deploy/local.env up --build --wait
```

打开：

- 编辑器：`http://localhost:8080/`
- 健康检查：`http://localhost:8080/api/v1/health`
- API 文档：`http://localhost:8080/docs`

验证完成后停止：

```powershell
docker compose --env-file deploy/local.env down
```

若还希望删除本地 Caddy 证书/配置卷，可显式追加 `--volumes`。生产环境不要在
未备份证书状态时执行该参数。

## 测试环境

1. 从 `deploy/staging.env.example` 复制出不提交到 Git 的
   `deploy/staging.env`。
2. 将 `TOURGRID_SITE_ADDRESS` 改成真实测试域名。
3. 将该域名的 A/AAAA 记录指向服务器，并确保公网可以访问 TCP 80 和 443。
4. 将 `TOURGRID_RELEASE` 与 `TOURGRID_IMAGE_TAG` 设为不可变候选版本，例如
   `0.2.0-rc.1`。
5. 运行完整测试，再启动 Compose：

```powershell
.\.venv\Scripts\python.exe -m pytest
docker compose --env-file deploy/staging.env config
docker compose --env-file deploy/staging.env up --detach --build --wait
```

Caddy 在站点地址为真实域名时自动申请和续期 HTTPS 证书。证书状态保存在
`caddy_data` 卷中，发布和重启时必须保留该卷。

测试环境至少验证：页面加载、上传转换、预览地址、24×24 原图导出、放大图导出、
移动端裁切、请求限流和错误日志。

## 正式发布与灰度

正式环境使用 `deploy/production.env.example` 的副本。发布前记录当前 Git 提交、
镜像标签和色板列表，并为新提交创建不可变版本标签。推荐先让独立测试域名运行
至少一个完整观察周期，再部署生产。

单台 Compose 主机无法安全完成按百分比流量切分。需要灰度时，应同时运行旧版和
候选版两个独立 Compose 项目/主机，由上游负载均衡器或 CDN 做权重路由；先让内部
用户和少量流量进入候选版，确认转换错误率、P95 延迟、429 比例和容器资源稳定后
再逐步提高权重。不要让两个项目共用同一个宿主机端口。

没有上游流量治理设施时，使用“测试域名 -> 正式域名”的两步发布，不宣称具备百分比
灰度能力。

## 回滚

回滚不是覆盖现有文件，而是重新部署上一个已验证的 Git 标签和镜像标签：

1. 将上游流量切回旧实例，或暂时摘除候选实例。
2. 恢复上一版源码/镜像标签对应的环境文件。
3. 执行 `docker compose ... up --detach --build --wait`。
4. 验证 `/api/v1/health`、一次固定图片转换和前端导出。
5. 保留失败版本的容器日志用于排查。

预览图片只存在 API 进程内存中，重启或回滚会使已有 `previewUrl` 失效；原始上传
图片不会长期保存。

## 日志、限流与异常监控

- Caddy 以 JSON 输出访问日志到 stdout。
- API 为每次请求返回 `X-Request-ID`，并输出不包含请求体的 JSON 访问日志。
- `POST /api/v1/convert` 使用按客户端 IP 的进程内滑动窗口限流。
- 设置 `TOURGRID_SENTRY_DSN` 后启用可选 Sentry 异常上报；默认不发送个人信息，
  性能采样默认关闭。
- 容器日志由部署平台采集。生产环境应配置日志轮转和保留周期，避免磁盘被占满。

当前限流器和预览缓存都是单进程内存状态，因此 API 固定使用一个 Uvicorn worker。
若以后横向扩容，必须先把限流和预览缓存迁移到 Redis 等共享服务。

## 安全与容量

- Caddy 限制请求体为 11 MB，API 再执行 10 MB 文件大小、解码尺寸和像素总数校验。
- API 使用非 root 用户、只读根文件系统、最小 Linux capabilities 和临时 `/tmp`。
- Caddy 添加基础安全响应头，并将前端、API 保持为同源。
- 现有前端仍使用内联事件处理器，因此 CSP 暂时允许 `script-src 'unsafe-inline'`；
  迁移为 `addEventListener` 后应移除此例外。
- 生产密钥只放在未提交的环境文件或平台密钥管理中。
- 根据真实转换耗时和内存使用调整并发数；不要只增加 worker 数。

## 色板兼容规则

`natural-64-v1` 是已发布的临时预测色板，任何正式色板都不能覆盖或修改它。正式
色板必须以新的 JSON 文件和新 ID 发布，例如 `official-v1`。上线前须同时验证：

- 旧 ID 仍可由 `/api/v1/palettes/natural-64-v1` 查询；
- 旧版存档仍能加载；
- 新请求明确记录 palette ID、palette version 和 converter version；
- 回滚后旧 API 仍能识别已经发布的所有历史色板。
