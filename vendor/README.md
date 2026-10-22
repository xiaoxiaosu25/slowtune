# 固定公共依赖与源码

这些包由慢听作者单独维护。慢听通过本目录的固定 npm 制品使用它们，并随附源码归档；克隆本仓库即可安装这些依赖，无须访问其他工程。

## 当前交付

| 包 | 安装制品 | 对应源码 |
| --- | --- | --- |
| `@studio/player@0.12.5` | [studio-player-0.12.5.tgz](studio-player-0.12.5.tgz) | [studio-player-0.12.5.tar.gz](sources/studio-player-0.12.5.tar.gz) |
| `@studio/music-sources@0.2.8` | [studio-music-sources-0.2.8.tgz](studio-music-sources-0.2.8.tgz) | [studio-music-sources-0.2.8.tar.gz](sources/studio-music-sources-0.2.8.tar.gz) |
| `@studio/recommendation@0.3.3` | [studio-recommendation-0.3.3.tgz](studio-recommendation-0.3.3.tgz) | [studio-recommendation-0.3.3.tar.gz](sources/studio-recommendation-0.3.3.tar.gz) |

三个固定制品和源码快照中的原创代码，在本交付中按根目录 [LICENSE](../LICENSE) 所载 AGPL-3.0-only 提供。第三方代码与材料遵循其各自声明，见归档内的 `THIRD-PARTY.md`（如有）及根目录[第三方声明](../第三方声明.md)。此范围不扩展到未随慢听交付的其他平台能力。

## 读取和重建源码

准备 Node.js `>=24.15.0` 与 npm，将三份源码归档解压到同一可写目录，得到同级的 `player/`、`music-sources/` 和 `recommendation/`。先在 `player/` 执行，再进入其他两个目录：

```powershell
npm ci
npm run build
```

`music-sources` 的开发依赖引用同级 `player`，因此保留上述目录关系。每份归档带有自己的 `README.md`、包清单、锁文件、构建配置、源码和许可证。固定 player 制品已包含原始源码；其独立重建配置为补充材料。其他两包的源码取自相应版本的正式实现或交付源码快照。来源说明见 [provenance.json](provenance.json)。

这些材料用于阅读、修改和重建相应包，不声明重建产物与历史制品逐字节相同，也不代表已经完成新的构建或设备验收。慢听默认仍安装上表中的固定制品。

## 维护

源码快照是版本交付材料。公共包修复通过维护者同步正式来源并生成新版本，再更新慢听的依赖、锁文件、安装制品、对应源码和 [provenance.json](provenance.json)。

不要直接编辑 `.tgz`、源码归档或 `node_modules`。来源记录使用包名、版本、平台内相对位置及仓库内源码入口，不依赖本机绝对路径或仓库外的验收链接。历史摘要字段仅保留原记录，不作为当前验收步骤。
