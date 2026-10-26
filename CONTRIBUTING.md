# 参与贡献

目前维护 Windows 桌面和现有移动 Web，欢迎反馈问题、提出建议或提交代码与文档。

## 反馈问题

先搜索 [Issues](https://github.com/xiaoxiaosu25/slowtune/issues)。提供应用版本、使用端、系统／浏览器版本、复现步骤及预期／实际结果；布局问题附窗口尺寸。Windows 运行故障可附「运行信息 → 复制诊断信息」。

附件去除凭据、账号二维码、私人路径和媒体签名地址，不上传完整资料目录、私人配置或原始日志。

## 本地开发

按 [README](README.md#源码启动)安装、构建和启动。依赖变更后执行 `npm ci`，源码修改后用 `npm run desktop:restart` 重建并打开。目录与资料位置见[运行维护](docs/运维/运行维护.md)。

| 目录 | 内容 |
| --- | --- |
| `src/` | React 界面和播放交互 |
| `desktop/` | Electron 窗口、宿主、歌词与本地状态 |
| `server/` | 来源、资料与 HTTP 服务 |
| `scripts/`、`tests/` | 维护工具和回归 |
| `vendor/` | 三个自有公共包及对应源码 |
| `docs/` | 公开文档 |

公共包按固定制品安装；修改时基于随附源码提交补丁，由维护者合入并更新版本，见 [vendor/README](vendor/README.md)。

## 提交修改

从 Fork 创建分支并提交 PR，较大功能先用 Issue 确认范围。提交围绕一个可验证目的，标题说明结果，可用 `fix:`、`feat:`、`test:`、`docs:`、`ci:` 或 `chore:`。

PR 写明原因、行为变化、影响与实际验证。提交前运行 `npm run source:check`；纯文档运行 `npm run docs:check`，代码按[验证规范](docs/开发/验证规范.md)构建和测试。合入前 `Source checks` 的 source、desktop 检查成功，审查讨论解决。

依赖更新同步包清单、锁文件、生成文档及许可材料，并执行 `npm audit --audit-level=high`。Dependabot 每周检查 npm／Actions；固定公共包人工更新。告警按实际运行入口评估。

源码、测试及公开文档在产品仓库提交；私人计划与机器维护资料独立保存。测试输出用脱敏 CI 附件，程序用 Releases 分发。原创贡献按 [AGPL-3.0-only](LICENSE) 提供。

## 修改文档

从[文档导航](docs/文档导航.md)找到主题正文，按当前源码直接修订，不累积历史过程。生成区块用 `npm run docs:generate` 更新；新增／改名同步导航、引用和 [public-source.mjs](scripts/public-source.mjs)。

文档工具或导出范围变化时运行相关用例。详细规则见[开发约定](docs/开发/开发约定.md)，依赖及源码交付见[开源与协作](docs/开发/开源与协作.md)。
