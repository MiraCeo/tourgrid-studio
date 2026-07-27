# Tourgrid Studio

《明日方舟》“巡展像素”非官方在线编辑器。

用户可以在浏览器中导入并裁切图片，将其转换为严格 24×24、限定
`natural-64-v1` 64色色板的像素画。原图和裁切参考图只保存在浏览器本地；
服务器只负责静态页面、版本化色板查询，以及不可变作品的保存与凭码读取。

## 当前能力

- 浏览器本地图片读取、正方形裁切和固定64色转换。
- 无抖动、Floyd–Steinberg 和 Atkinson 三种本地转换方式。
- 24×24 Canvas 逐像素绘制、白色擦除、撤销重做和手动保存点。
- 20%～400%缩放、画布移动、导航器、参考图透明度和辅助线开关。
- 颜料面板、最近色吸管、用色排序和逐色复刻进度。
- 原始24×24 PNG、16倍最近邻放大图和拼豆图纸导出。
- 裁切参考图以256×256 WebP保存到浏览器 IndexedDB。
- PostgreSQL以432字节色板索引保存不可变作品。
- 相同像素内容返回同一个12位Base58分享码；首次标题和作者不可覆盖。
- Caddy、FastAPI和PostgreSQL组成同源Docker Compose部署。

当前默认色板 `natural-64-v1` 是临时预测色板。未来色板必须使用新的ID，例如
`official-v1`，不能覆盖已经发布的色板。

## 架构边界

```text
浏览器
├─ 图片裁切与64色转换
├─ Canvas编辑与本地工程状态
├─ 参考图IndexedDB存储
└─ 导出PNG/图纸

Caddy
├─ 静态前端
└─ /api、/docs、/openapi.json -> FastAPI

FastAPI
├─ 健康检查
├─ 版本化色板查询
└─ 不可变作品保存与读取 -> PostgreSQL
```

服务器不再接收用户图片，也不提供服务器图片转换或临时预览接口。

## 仓库结构

```text
tourgrid-studio/
├─ backend/
│  ├─ palette.py            # 版本化色板读取与校验
│  └─ api/                  # FastAPI、作品仓库、限流与监控
├─ frontend/
│  ├─ index.html
│  ├─ css/editor.css
│  └─ js/
│     ├─ natural-64-v1.js   # 浏览器固定64色色板
│     ├─ import.js          # 裁切与浏览器本地转换
│     ├─ editor.js          # Canvas、历史与导航器
│     ├─ app.js             # 工具、颜料与复刻面板
│     ├─ export.js          # PNG与图纸导出
│     ├─ storage.js         # 本地存档与迁移
│     ├─ reference-storage.js
│     ├─ work-codec.js
│     └─ works.js
├─ palettes/                # 版本化色板JSON
├─ tests/                   # API、存储、前端契约与浏览器回归
├─ docs/                    # API、部署与阶段文档
├─ docker/
├─ deploy/
└─ pyproject.toml
```

## 本地安装

需要Python 3.11～3.13。Pillow仅用于开发测试，不会进入生产依赖。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m playwright install chromium
```

使用锁文件复现开发环境：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pip install -e . --no-deps
```

## 本地启动

```powershell
.\.venv\Scripts\tourgrid-api.exe
```

- 编辑器：`http://127.0.0.1:8000/`
- API文档：`http://127.0.0.1:8000/docs`

直接启动但未配置 `TOURGRID_DATABASE_URL` 时，编辑、导入和导出仍可使用；作品
保存接口会返回 `503 work_storage_unavailable`。

## Docker部署

```powershell
Copy-Item deploy/.env.example deploy/local.env
docker compose --env-file deploy/local.env up --detach --build --wait
```

访问 `http://localhost:8080/`。正式域名、HTTPS、备份和回滚见
[部署与发布](docs/deployment.md)。

## API

- `GET /api/v1/health`
- `GET /api/v1/palettes`
- `GET /api/v1/palettes/{palette_id}`
- `POST /api/v1/works`
- `GET /api/v1/works/{code}`

完整契约见 [API v1](docs/api-v1.md)。

## 测试

运行全部测试：

```powershell
.\.venv\Scripts\python.exe -m pytest
```

只运行浏览器回归：

```powershell
.\.venv\Scripts\python.exe -m pytest -m browser
```

测试分层：

- `tests/test_api.py`：健康、色板、作品接口和已删除路由契约。
- `tests/test_work_store.py`：内存作品仓库、Base58短码和内容去重。
- `tests/test_postgres_work_store.py`：可选的真实PostgreSQL集成测试。
- `tests/test_frontend.py`：前端静态结构、脚本语法和状态契约。
- `tests/browser/`：真实Chromium中的导入、绘制、复刻、持久化和导出流程。
- `tests/fixtures/`：浏览器本地转换使用的确定性源图片。

PostgreSQL集成测试需要设置 `TOURGRID_TEST_DATABASE_URL`，未设置时会跳过。

浏览器回归主要覆盖：

1. 24×24全白初始画布与固定64色色板。
2. 连续绘制、撤销重做和手动保存点。
3. 复刻模式只读、逐色完成状态和进度持久化。
4. 透明图、横图和竖图的浏览器本地导入。
5. 256×256 WebP参考图持久化与完整历史恢复。
6. 24×24 PNG和最近邻放大图导出。
7. 432字节作品发布、12位分享码和凭码读取。
8. 640～900px窄屏顶部与导出菜单边界。

新增或删除核心用户流程时，应同步更新测试和
[阶段四测试报告](docs/stage-4-test-report.md)。

## 隐私与保存

- 原始导入图片不会上传服务器。
- 裁切参考图只保存到当前浏览器IndexedDB。
- 分享接口只接收432字节像素索引、色板版本及可选标题和作者。
- “永久保存”依赖PostgreSQL数据卷和可恢复备份，不代表无需运维。

## 声明

Tourgrid Studio是非官方项目，与鹰角网络或《明日方舟》官方无隶属关系。
