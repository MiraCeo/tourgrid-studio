# 部署与发布

## 架构

```text
浏览器 -> Caddy (:80/:443) -> 静态前端
                         \-> /api、/docs、/openapi.json -> FastAPI
                                                             \-> PostgreSQL
```

FastAPI不向宿主机公开端口，只允许Caddy通过Compose内部网络访问。PostgreSQL
只绑定宿主机回环地址，作品数据保存在 `postgres_data` 卷中。

图片导入和64色转换完全在浏览器中执行，API容器不安装科学计算或图片解码依赖。

## 本地容器验收

```powershell
Copy-Item deploy/.env.example deploy/local.env
docker compose --env-file deploy/local.env config
docker compose --env-file deploy/local.env up --detach --build --wait
```

访问：

- 编辑器：`http://localhost:8080/`
- 健康检查：`http://localhost:8080/api/v1/health`
- API文档：`http://localhost:8080/docs`

停止服务：

```powershell
docker compose --env-file deploy/local.env down
```

生产环境不要在未备份PostgreSQL和Caddy数据时使用 `down --volumes`。

## 测试环境

1. 将 `deploy/staging.env.example` 复制为不提交的 `deploy/staging.env`。
2. 设置测试域名、数据库强密码和不可变版本标签，例如 `0.3.0-rc.1`。
3. 将域名A/AAAA记录指向服务器并开放TCP 80和443。
4. 运行完整测试并启动Compose。

```powershell
.\.venv\Scripts\python.exe -m pytest
docker compose --env-file deploy/staging.env config
docker compose --env-file deploy/staging.env up --detach --build --wait
```

至少验证：

- 页面和静态资源加载；
- 浏览器本地裁切、透明图、横图和竖图转换；
- 原始PNG、放大图和图纸导出；
- 作品保存、重复内容去重和凭码读取；
- 浏览次数递增；
- 640～900px窄屏布局；
- 请求限流与错误日志。

## 正式发布

正式环境使用 `deploy/production.env.example` 的副本。发布前记录：

- 当前Git提交和镜像标签；
- 当前色板ID和版本；
- PostgreSQL备份位置与恢复验证结果；
- Caddy数据卷状态。

单台Compose主机不提供按百分比灰度。需要灰度时，运行互相隔离的旧版和候选版，
由上游负载均衡器或CDN分配流量；没有流量治理设施时，采用“测试域名→正式域名”
两阶段发布。

## 回滚

1. 将流量切回旧实例或停止候选实例。
2. 恢复上一版源码/镜像标签对应的环境文件。
3. 运行 `docker compose ... up --detach --build --wait`。
4. 验证health、页面、色板查询、作品保存与读取、浏览器本地导入和前端导出。
5. 保留失败版本日志。

作品表是持久数据。应用回滚不得覆盖或删除 `postgres_data`。

## 日志、限流与监控

- Caddy和API输出JSON访问日志。
- API为请求返回 `X-Request-ID`，日志不记录作品像素正文。
- `POST /api/v1/works` 使用按客户端IP的进程内滑动窗口限流。
- `TOURGRID_RATE_LIMIT_MAX_CLIENTS` 限制内存中跟踪的客户端数量。
- 设置 `TOURGRID_SENTRY_DSN` 后启用可选Sentry上报，默认不发送个人信息。
- 当前API使用单个Uvicorn worker；横向扩容前应将限流迁移到共享服务。

## 安全与容量

- Caddy默认限制请求体为128KB，远大于单个作品JSON但不允许大文件上传。
- API以非root用户运行，根文件系统只读，`/tmp` tmpfs限制为32MB。
- Caddy添加安全响应头，前端和API保持同源。
- 当前前端仍有内联事件处理器，因此CSP暂时允许 `script-src 'unsafe-inline'`。
- `TOURGRID_DB_PASSWORD` 必须使用独立强密码。
- 定期使用 `pg_dump` 备份作品表，并在独立环境验证恢复。

## 色板兼容规则

`natural-64-v1` 是已发布的临时预测色板，不能覆盖或修改。正式色板必须使用新的
JSON文件和ID，例如 `official-v1`。上线前验证：

- 旧ID仍可通过 `/api/v1/palettes/natural-64-v1` 查询；
- 旧版浏览器存档和分享作品仍能读取；
- 新作品明确记录palette ID与palette version；
- 回滚版本能识别所有已经发布的历史色板。
