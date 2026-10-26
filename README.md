<h1 align="center">慢听 SlowTune</h1>

<p align="center"><strong>发现喜欢的音乐，留下想听的版本。</strong></p>

<p align="center">一款面向 Windows 的个人音乐播放器，支持 B站搜索、歌单整理、歌曲多版本与沉浸歌词。</p>

<p align="center">
  <a href="https://github.com/xiaoxiaosu25/slowtune/releases"><img alt="最新开发预览版" src="https://img.shields.io/github/v/release/xiaoxiaosu25/slowtune?include_prereleases&amp;label=preview&amp;color=a92e32"></a>
  <a href="https://github.com/xiaoxiaosu25/slowtune/releases"><img alt="Windows x64" src="https://img.shields.io/badge/Windows-x64-365e8d"></a>
  <a href="LICENSE"><img alt="AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-60734b"></a>
</p>

<p align="center">
  <a href="https://github.com/xiaoxiaosu25/slowtune/releases"><strong>下载 Windows 预览版</strong></a> ·
  <a href="#界面预览">界面预览</a> ·
  <a href="#功能">功能</a> ·
  <a href="#源码启动">源码启动</a> ·
  <a href="https://github.com/xiaoxiaosu25/slowtune/issues">反馈问题</a>
</p>

![慢听实际播放 Winky诗《松烟入墨》：黑红唱片、B站来源、音质信息、歌词与播放控制](docs/images/player.jpg)

<p align="center"><em>《松烟入墨》· Winky诗，真实 B站来源播放画面。</em></p>

**当前为开发预览版，主要维护 Windows x64。** [下载与启动](#下载-windows-版) · [支持范围与当前限制](docs/产品/当前限制.md)

## 功能

| 功能 | 可以做什么 |
| --- | --- |
| 发现与搜索 | 浏览 B站推荐、应用内关注更新，按歌名／歌手搜索，或粘贴支持的来源链接 |
| 多平台榜单 | 查看网易云、QQ、B站与 Apple Music 榜单，从支持的视频来源匹配播放，也可手动挑选版本 |
| 播放展示 | 切换唱片、原始封面、方形、慢转圆形、横向音波与圆形音环，音波跟随真实音频频谱 |
| 沉浸与悬浮歌词 | 自动匹配、手动选择、导入 LRC／文本和时间校准；Windows 独立程序支持桌面悬浮歌词 |
| 歌单与歌曲多版本 | 收藏与自建歌单，封面、搜索、排序和重排；同一首歌可保留多个版本，设置默认版本或歌单固定版本 |
| 队列与播放控制 | 顺序、随机、列表／单曲循环，队列重排、倍速、进度、音量与快进退 |
| 睡眠定时 | 倒计时、自然播完 N 首或播完当前曲；结束时暂停、停止，Windows 独立程序还可退出慢听 |
| 外观与资料 | 四套配色、明暗模式、自定义欢迎页；B站扫码登录与收藏夹关联，歌单 JSON 导入导出 |

完整操作说明见[产品功能](docs/产品/产品功能.md)。YouTube 可按需启用，默认关闭，需另行配置网络与取源工具。

## 界面预览

主图与下方截图均取自实际运行的应用网页，使用已有正式资料、真实歌曲、封面、歌词和平台返回的榜单。桌面网页显示底部歌词条，独立 Windows 程序使用桌面悬浮歌词。点击图片可查看大图。

| 沉浸歌词 | 收藏与歌单 |
| :---: | :---: |
| [![松烟入墨的真实沉浸歌词：唱片、同步高亮歌词和播放控制](docs/images/lyrics.jpg)](docs/images/lyrics.jpg) | [![真实收藏歌单：松烟入墨、天龙八部之宿敌等歌曲与专辑封面](docs/images/library.jpg)](docs/images/library.jpg) |
| 唱片与歌词同屏，跟随进度阅读，也可更换歌词或校准时间。 | 收藏喜欢的歌，换封面、搜歌、排序，并管理歌曲的不同播放版本。 |

| 搜索喜欢的版本 | 多平台音乐榜单 |
| :---: | :---: |
| [![许嵩的真实 B站搜索结果、分 P 信息与筛选说明](docs/images/search.jpg)](docs/images/search.jpg) | [![网易云热歌榜真实歌曲、歌手、封面与来源更新时间](docs/images/charts.jpg)](docs/images/charts.jpg) |
| 保留来源结果与分 P 信息，筛选偏好可调整，听之前先挑喜欢的版本。 | 单首点播或播放整榜，收藏歌曲，也能打开搜索选择其他版本。 |

| 睡眠定时 | 外观与主题 |
| :---: | :---: |
| [![睡眠定时器的快捷时长、自定义结束条件与结束动作](docs/images/sleep-timer.jpg)](docs/images/sleep-timer.jpg) | [![外观设置中的明暗模式与暖纸炭黑、经典薄荷、晴樱粉、珊瑚红四套配色](docs/images/appearance.jpg)](docs/images/appearance.jpg) |
| 再听一会，或等这一首自然结束，让音乐陪你入睡。 | 选择白天、黑夜或跟随系统，搭配自己喜欢的主题色。 |

## 移动网页

手机浏览器连接现有服务版，可浏览“发现、音乐库、我的”，使用迷你播放器、完整播放页与直接歌词切换。返回浏览后保留原来的页面上下文。

| 音乐库 | 完整播放 | 歌词阅读 |
| :---: | :---: | :---: |
| <a href="docs/images/mobile-library.jpg"><img src="docs/images/mobile-library.jpg" width="230" alt="移动网页真实音乐库：收藏、自建歌单与迷你播放器"></a> | <a href="docs/images/mobile-player.jpg"><img src="docs/images/mobile-player.jpg" width="230" alt="移动网页真实播放松烟入墨：唱片、歌曲版本和完整播放控制"></a> | <a href="docs/images/mobile-lyrics.jpg"><img src="docs/images/mobile-lyrics.jpg" width="230" alt="移动网页松烟入墨歌词：当前句高亮、更换歌词与校准入口"></a> |

同一服务共享歌曲、歌单与收藏，队列和主题等偏好由各自浏览器保存。移动端当前为 Web 界面，连接方式见[启动与访问](docs/产品/启动与访问.md)；Android／iOS 原生客户端与独立手机运行时尚未提供。

## 下载 Windows 版

1. 打开 [Releases](https://github.com/xiaoxiaosu25/slowtune/releases)，选择标记为 **Pre-release** 的版本。
2. 下载 `SlowTune-<版本>-windows-x64.zip`，完整解压到当前用户可写的目录。
3. 双击 `SlowTune.exe`，欢迎页结束后即可进入，无需另装 Node.js。

请保留完整解压目录。GitHub 自动生成的 `Source code.zip` 是源码，不能直接作为程序运行。

**更新与备份：** 先退出慢听，备份并保留 `SlowTune.exe` 同级的整个 `data/` 文件夹。完整解压新版本后保留自己的资料，具体方法见[运行维护](docs/运维/运行维护.md#windows-桌面运行)。

当前程序未签名，没有安装器或自动更新；设备验证范围见[当前限制](docs/产品/当前限制.md)。

## 使用说明

- B站和 YouTube 使用非官方接入方式，功能可用性受平台接口、账号权限、地区和网络影响。
- YouTube 默认关闭，启用前需配置网络和外部取源工具，见[来源工具与账号](docs/运维/运行维护.md#来源工具与账号)。
- 开启B站收藏夹关联后，本地新增和删除可能同步修改远端收藏夹；请先核对关联预览。
- 当前不提供音视频下载或完整离线曲库。歌单 JSON 仅备份歌曲资料；完整备份请退出程序后复制整个 `data/`。

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

## 参与贡献

欢迎通过 [Issues](https://github.com/xiaoxiaosu25/slowtune/issues) 反馈问题或提出建议，通过 Pull Request 改进代码和文档。

开发环境、代码目录和提交说明见[贡献指南](CONTRIBUTING.md)，其他文档见[文档导航](docs/文档导航.md)。

## 许可证

本项目采用 [AGPL-3.0-only](LICENSE)，版权说明见 [NOTICE](NOTICE)。第三方依赖、字体和素材的许可见[第三方声明](第三方声明.md)。
