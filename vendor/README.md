# 本地依赖包

本目录包含四个 `@studio/*` 依赖的 npm 安装包和对应版本源码。根目录 `package.json` 通过 `file:vendor/...` 引用安装包，执行 `npm ci` 时自动安装。

日常应用开发使用根目录 [README](../README.md#源码启动) 的命令；修改或升级这些包时，才需按下文重建相应依赖。

## 包与源码

| 包 | 安装制品 | 对应源码 |
| --- | --- | --- |
| `@studio/lyrics@0.1.0` | [studio-lyrics-0.1.0.tgz](studio-lyrics-0.1.0.tgz) | [studio-lyrics-0.1.0.tar.gz](sources/studio-lyrics-0.1.0.tar.gz) |
| `@studio/player@0.12.15` | [studio-player-0.12.15.tgz](studio-player-0.12.15.tgz) | [studio-player-0.12.15.tar.gz](sources/studio-player-0.12.15.tar.gz) |
| `@studio/music-sources@0.2.14` | [studio-music-sources-0.2.14.tgz](studio-music-sources-0.2.14.tgz) | [studio-music-sources-0.2.14.tar.gz](sources/studio-music-sources-0.2.14.tar.gz) |
| `@studio/recommendation@0.3.5` | [studio-recommendation-0.3.5.tgz](studio-recommendation-0.3.5.tgz) | [studio-recommendation-0.3.5.tar.gz](sources/studio-recommendation-0.3.5.tar.gz) |

上述包的原创代码采用 [AGPL-3.0-only](../LICENSE)。第三方许可见归档内的 `THIRD-PARTY.md`（如有）及项目的[第三方声明](../第三方声明.md)。版本和源码来源记录在 [provenance.json](provenance.json)。

## 读取和重建源码

准备 Node.js `>=24.15.0` 与 npm，将源码归档解压到同一可写目录，得到同级的 `player/`、`music-sources/`、`lyrics/` 和 `recommendation/`。先在 `player/` 执行，再进入其他目录：

```powershell
npm ci
npm run build
```

`music-sources` 的开发依赖引用同级 `player`，因此需要保留上述目录关系。各包的构建说明见解压后的 `README.md`。重建后需更新慢听所引用的安装包，应用才会使用修改后的代码。

## 维护

修改包源码时，在 PR 中附上基于对应版本的源码补丁，提交流程见[贡献指南](../CONTRIBUTING.md)。维护者将修复合入包源码、生成新版本，并同步更新慢听的依赖声明、锁文件、安装包、源码归档和来源记录。

安装包和源码归档应由构建生成，避免直接编辑压缩包或 `node_modules`。
