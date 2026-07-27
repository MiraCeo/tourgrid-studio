# 阶段四：回归测试报告

## 测试边界

当前测试围绕两个独立边界：

1. 浏览器负责图片裁切、固定64色转换、Canvas编辑、复刻和导出。
2. FastAPI负责色板查询、不可变作品保存和凭码读取。

服务器图片转换、上传、worker、转换超时和临时预览基线已移除，不再属于测试范围。

## 确定性源图片

`tests/fixtures/` 中的图片由 `generate_visual_fixtures.py` 生成：

| 文件 | 尺寸 | 浏览器回归用途 |
|---|---:|---|
| `avatar-reference-synthetic.png` | 256×256 | 主体和五官可辨识性 |
| `transparent-subject.png` | 192×192 RGBA | 透明像素默认白色 |
| `landscape-scene.png` | 360×180 | 横图裁切和历史恢复 |
| `portrait-scene.png` | 180×360 | 竖图裁切和历史恢复 |
| `large-pattern.png` | 4096×3072 | 保留的大图手动性能素材 |

这些文件是浏览器本地转换输入，不是服务器转换视觉基线。旧
`tests/fixtures/baselines/` 已删除。

## 自动测试分层

- `test_api.py`：health、色板、作品接口、同源页面和旧路由404。
- `test_work_store.py`：不可变内容、Base58短码和内存存储。
- `test_postgres_work_store.py`：可选真实PostgreSQL集成。
- `test_frontend.py`：HTML、CSS、JavaScript和状态契约。
- `test_deployment.py`：Compose、Caddy、生产依赖与容器安全。
- `test_observability.py`：请求ID、作品写入限流和监控配置。
- `tests/browser/`：真实Chromium用户流程。

## 浏览器回归

主要场景包括：

- 24×24全白初始画布和固定64色色板；
- 连续绘制、撤销重做和100步历史上限；
- 手动保存点及恢复后再次撤销；
- 复刻模式只读、颜色完成状态和每作品进度；
- 吸管最近色匹配与面板定位；
- 横图、竖图、透明图的本地转换；
- 参考图256×256 WebP持久化；
- 导入、清空和参考图的完整撤销恢复；
- 24×24 PNG及16倍最近邻图导出；
- 作品发布、分享码复制和凭码读取；
- 640、768、900px窄屏导出菜单边界。

浏览器用例使用独立上下文，不依赖其他用例留下的localStorage或IndexedDB。

## API回归

API测试确认：

- health返回 `appVersion` 和默认色板；
- 色板列表与详情可查询；
- 作品像素解码后严格为432字节；
- 同内容返回相同12位Base58分享码；
- 后续提交不能覆盖首次标题与作者；
- 成功读取原子增加浏览次数；
- 未配置数据库时返回统一503错误；
- `/api/v1/convert` 和临时预览路由返回404；
- OpenAPI不再发布服务器转换接口。

## 执行

完整测试：

```powershell
.\.venv\Scripts\python.exe -m pytest
```

浏览器回归：

```powershell
.\.venv\Scripts\python.exe -m pytest -m browser
```

PostgreSQL集成测试：

```powershell
$env:TOURGRID_TEST_DATABASE_URL='postgresql://...'
.\.venv\Scripts\python.exe -m pytest tests/test_postgres_work_store.py
```

## 维护规则

- 新增用户流程时同步增加浏览器回归。
- 修改作品编码或色板版本时同步更新API和codec测试。
- 新增源图片必须记录用途和确定性生成方式。
- 不重新建立服务器转换PNG基线；算法视觉验证应针对浏览器实际输出。
