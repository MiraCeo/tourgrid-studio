# Tourgrid Studio

《明日方舟》“巡展像素”非官方在线编辑器。

用户可以上传图片、调整正方形裁切区域，由服务器将图片转换为固定尺寸的像素画并严格限制到版本化色板。转换后仍可在浏览器中逐像素编辑、统计颜色并导出 PNG 或图纸。

## 当前状态

阶段三已经完成：

- Python 转换程序已经模块化并保留 CLI。
- FastAPI 提供版本化色板和图片转换 API。
- 前端默认使用服务器 Pyxelate 转换。
- 浏览器本地 K-means 算法作为明确标识的备用模式保留。
- 前端已拆分为 HTML、CSS 和多个 JavaScript 模块。
- 存档包含来源、色板版本和转换器版本，并兼容旧版 localStorage。
- 裁切区支持鼠标、单指移动和双指缩放。
- 支持原始尺寸 PNG、最近邻放大图和拼豆图纸导出。

当前默认色板 `natural-64-v1` 是临时预测色板。未来正式色板必须使用新的 ID（例如 `official-v1`），不能覆盖旧版本。

## 仓库结构

```text
tourgrid-studio/
├─ backend/                 # 转换核心、CLI 与 FastAPI
│  └─ api/                  # 上传校验、转换调度、预览缓存
├─ frontend/
│  ├─ index.html
│  ├─ css/editor.css
│  └─ js/
│     ├─ storage.js         # 存档校验和版本迁移
│     ├─ conversion-api.js  # API 响应校验和错误映射
│     ├─ state.js           # 编辑器状态和色板数据
│     ├─ editor.js          # Canvas 编辑、撤销和导航器
│     ├─ export.js          # PNG 与图纸导出
│     ├─ import.js          # 裁切、上传和本地备用转换
│     └─ app.js             # 工具、色板和页面控制
├─ palettes/                # 版本化色板 JSON
├─ tests/                   # 后端和前端行为测试
├─ docs/                    # 架构、API 和阶段说明
├─ LICENSES/                # 第三方许可证
├─ convert_image.py         # 兼容的图片转换命令入口
└─ pyproject.toml
```

## 安装

需要 Python 3.11～3.13、Git，以及能够安装科学计算依赖的环境。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
```

若需要完全复现锁定环境：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pip install -e . --no-deps
```

## 启动编辑器

```powershell
.\.venv\Scripts\tourgrid-api.exe
```

然后访问：

- 编辑器：`http://127.0.0.1:8000/`
- API 文档：`http://127.0.0.1:8000/docs`

推荐始终通过 FastAPI 打开编辑器，不要直接双击 `frontend/index.html`。同源运行可确保静态资源、色板和转换接口使用同一个服务版本。

## 图片导入模式

### 服务器 Pyxelate（默认）

- 色板：`natural-64-v1`
- 映射模式：`direct`
- 默认抖动：`none`
- Sobel：`3`
- depth：`1`
- SVD：启用
- 裁切后的正方形 PNG 只用于当前请求，不长期保存

前端直接校验并读取响应中的 `hexPixels`，不会重新分析预览 PNG。

### 浏览器本地备用

该模式保留原有 K-means++ 和误差扩散算法，用于服务器不可用时继续工作。其结果不保证属于巡展 64 色色板，界面会明确显示“本地备用转换”。

## 命令行转换

```powershell
.\.venv\Scripts\python.exe convert_image.py input.png
```

或：

```powershell
.\.venv\Scripts\python.exe -m backend input.png
```

实验性两阶段映射必须显式选择：

```powershell
.\.venv\Scripts\python.exe -m backend input.png --mapping-mode two-stage
```

## API

已实现：

- `GET /api/v1/health`
- `GET /api/v1/palettes`
- `GET /api/v1/palettes/{palette_id}`
- `POST /api/v1/convert`
- `GET /api/v1/results/{result_id}/preview.png`

完整参数、限制和响应格式见 [API v1](docs/api-v1.md)。

## 测试

```powershell
.\.venv\Scripts\python.exe -m pytest
```

测试覆盖：

- 固定色板约束和 24×24 输出
- 相同输入和版本的稳定性
- API 上传类型、大小、尺寸、并发和超时限制
- 前端静态资源入口
- localStorage v1/v2 到 v3 的迁移
- API 像素矩阵尺寸和颜色校验
- HTTP 错误映射
- 默认服务器模式和显式本地备用模式
- 原始 PNG 与最近邻预览导出契约
- 所有前端 JavaScript 文件的语法

## 许可证与声明

图片像素化使用 [Pyxelate](https://github.com/sedthh/pyxelate)。其 MIT 许可证和版权声明保存在 `LICENSES/Pyxelate-LICENSE.txt`。

Tourgrid Studio 是非官方项目，与鹰角网络或《明日方舟》官方无隶属关系。
