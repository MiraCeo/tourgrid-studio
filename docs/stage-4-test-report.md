# 阶段四：测试与视觉基线报告

## 目标

阶段四建立可重复的转换回归体系，覆盖：

- 严格 24×24 输出
- 版本化色板约束
- 相同输入和参数的稳定性
- 透明 PNG、横图、竖图和大图
- 原始 PNG 与最近邻预览
- API 并发、排队和处理超时
- 桌面、手机和平板浏览器布局

## 固定测试图片集

测试素材位于 `tests/fixtures/`，由
`generate_visual_fixtures.py` 确定性生成。`manifest.json` 保存每张源图的尺寸、模式和 SHA-256。

| 文件 | 尺寸 | 用途 |
|---|---:|---|
| `avatar-reference-synthetic.png` | 256×256 | 五官、头发和主体轮廓的合成头像替代物 |
| `transparent-subject.png` | 192×192 RGBA | 完全透明、半透明和不透明区域 |
| `landscape-scene.png` | 360×180 | 横图中心裁切 |
| `portrait-scene.png` | 180×360 | 竖图中心裁切 |
| `large-pattern.png` | 4096×3072 | 大尺寸解码和转换 |

### 原始头像素材状态

最初项目总结要求包含“当前头像测试图”，但该原图不在仓库、用户目录或本次会话提供的文件中。当前使用可复现的合成头像建立测试框架，并在 `manifest.json` 中明确标记它不是用户原图。

获得原始头像后，应保存为 `tests/fixtures/avatar-reference-original.png`，加入生成清单并通过基线更新脚本发布新的视觉基线。不能用合成图片冒充原始素材。

## 视觉基线

基线位于 `tests/fixtures/baselines/`：

- 每个输入对应一个严格 24×24 PNG。
- 每个输入对应一个 240×240 的 10 倍最近邻预览。
- `baseline.json` 记录像素 SHA-256、实际使用颜色数和颜色 ID。

发布基线使用默认参数：

```text
width=24
height=24
fit=crop
dither=none
sobel=3
depth=1
svd=true
mapping_mode=direct
palette_id=natural-64-v1
```

测试会重新运行真实 Pyxelate 转换，逐像素比对基线，并确认所有不透明像素属于 64 色色板。

仅在算法、依赖或色板版本被有意升级，并完成视觉审查后运行：

```powershell
.\.venv\Scripts\python.exe tests\fixtures\update_visual_baselines.py
```

## API 并发与超时

自动测试覆盖：

- `max_concurrent_conversions=2` 时，两次转换可以同时进入处理器。
- `max_concurrent_conversions=1` 时，第二次请求在队列超时后返回 `503 server_busy`。
- 实际转换子进程超过处理时限会被终止并产生 `ConversionTimedOut`。
- API 将处理超时映射为 `504 conversion_timeout`。

## 浏览器回归矩阵

测试地址为本地 FastAPI 同源页面。

| 场景 | 视口 | 结果 |
|---|---:|---|
| 桌面 | 1280×900 | 编辑器完整显示，无横屏提示 |
| 平板横屏 | 1024×768 | 编辑器完整显示，无横屏提示 |
| 手机横屏 | 844×390 | 编辑器位于视口内，裁切框保持正方形 |
| 手机竖屏 | 390×844 | 正确显示“请横屏使用” |

响应式契约还会自动检查：

- `900px` 移动端断点存在。
- 移动裁切框宽高使用相同的 `min(320px, 42dvh)`。
- 页面监听 `resize` 和 `orientationchange`。
- 裁切区启用触摸手势并禁止浏览器默认触摸缩放。

## 执行

完整测试：

```powershell
.\.venv\Scripts\python.exe -m pytest
```

仅运行视觉回归：

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_visual_regression.py
```
