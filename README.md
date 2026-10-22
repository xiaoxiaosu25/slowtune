# 慢听 SlowTune

慢听是一款面向 Windows 的个人音乐播放器，支持 B站音乐搜索、在线播放、歌单管理和桌面歌词。

**当前为开发预览版。** 可按下方步骤从源码运行，部分真实设备场景仍在验证。

## 功能

- B站搜索、榜单和关注更新，支持扫码登录与收藏夹关联。
- 歌单、收藏和歌曲多版本管理，支持 JSON 导入与导出。
- 播放队列、倍速播放和睡眠定时。
- 沉浸歌词与桌面悬浮歌词，支持歌词导入和时间偏移调整。
- 主题与外观设置，本地保存个人资料。
- 可选启用 YouTube 来源。

## 源码启动

需要 Windows、Git 和 Node.js `>=24.15.0`（含 npm）。

```powershell
git clone https://github.com/xiaoxiaosu25/slowtune.git
cd slowtune
npm ci
npm run desktop:build
npm run desktop
```

构建完成后，也可双击仓库根目录的 `一键启动.cmd` 打开应用。

## 使用说明

- B站和 YouTube 使用非官方接入方式，功能可用性受平台接口、账号权限、地区和网络影响。
- YouTube 默认关闭，启用前需配置网络和外部取源工具，见[来源工具与账号](docs/运维/运行维护.md#来源工具与账号)。
- 开启B站收藏夹关联后，本地新增和删除可能同步修改远端收藏夹。

完整功能见[产品功能](docs/产品/产品功能.md)，资料保存与备份见[运行维护](docs/运维/运行维护.md#windows-桌面运行)，已知限制与待验证场景见[桌面开发计划](docs/计划/桌面应用方案.md#剩余任务与完成条件)。

## 参与贡献

欢迎通过 [Issues](https://github.com/xiaoxiaosu25/slowtune/issues) 反馈问题或提出建议，通过 Pull Request 改进代码和文档。

开发环境、代码目录和提交说明见[贡献指南](CONTRIBUTING.md)，其他文档见[文档导航](docs/文档导航.md)。

## 许可证

本项目采用 [AGPL-3.0-only](LICENSE)，版权说明见 [NOTICE](NOTICE)。第三方依赖、字体和素材的许可见[第三方声明](第三方声明.md)。
