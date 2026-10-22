# 项目协作准则

独立克隆先读 [README](README.md)、[开发约定](docs/开发/开发约定.md)和[开源与协作](docs/开发/开源与协作.md)。下方 Studio 导航适用于作者的完整工作区；仓库外入口未随独立克隆提供时，以本仓库文档工作，不创建另一套 Studio。

<!-- studio:begin -->
## Studio 工作区入口

开始先读 [Studio 规则](../../AGENTS.md)和[工作区说明](../../README.md)；目录职责见[代码地图](../../platform/docs/03-%E4%BB%A3%E7%A0%81%E5%9C%B0%E5%9B%BE.md)。链接相对本文件解析。

从本目录执行 `node ../../platform/scripts/workspace.mjs paths .` 查看开发路径，`audit .` 查看本地输出候选；命令明确区分建议路径与已声明路径，现役实际路径以本项目脚本及运维说明为准。涉及公共能力时再读取平台规则与相关能力说明。参考工程只读。
<!-- studio:end -->

## 桌面开发交付

当前处于开发测试阶段，默认只进行源码启动、本地构建与验证。仅在用户明确要求打包时，才执行桌面打包或生成分发 EXE／ZIP。

## 移动端暂停

暂停移动端开发与修改，直至用户明确下达恢复命令。不新增移动端功能，不调整移动端布局、样式和交互，不顺带进行响应式重构。共享代码改动必须隔离到桌面路径，保持移动端现有表现。既有移动端用例仅用于回归保护。

## Local file inspection

For reading, searching, and finding local files, prefer FastCtx's `inspect_local_file`, `grep`, and `glob`. Use plain absolute filesystem paths. Batch related text reads in one `inspect_local_file` call and follow the exact continuation parameters when continuing a Partial result.

Use FastCtx's `replace` for mechanical replacements, and `apply_patch` for generated content, semantic rewrites, or small local edits.

## 子代理

只有窄范围、只读的事实抽取、文件定位、日志核验或规则明确的分类任务才调用 `quick_scan`；其余任务由主代理直接完成。调用时传入自包含的目标、路径、限制和完成条件，不让 `quick_scan` 修改文件或派生新的子代理。
