# Alger Music NAS

基于 [Alger / algerkong](https://github.com/algerkong) 的 [AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer) 制作的**非官方 NAS 网页适配版**。保留原版播放器体验，增加 NAS 直接导入 LX 音源、多脚本切换和多平台搜索。

当前 NAS 版本：**0.3.4**。上游基线：**5.1.0**，提交 [`b15617ce`](https://github.com/algerkong/AlgerMusicPlayer/commit/b15617ce8652e12a4314be66e2c35ff1f7602a10)。这表示本项目采用的代码基线，不表示始终同步上游最新提交。

本仓库不附带真实音源脚本、音源下载链接、账号或个人配置。音源由使用者自行导入。

## 原作者与来源

- 原作者主页：**[Alger / algerkong](https://github.com/algerkong)**。
- 原项目：**[algerkong/AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer)**。
- 原版说明存档：[UPSTREAM_README.md](docs/UPSTREAM_README.md)。其中的桌面安装、发布和赞助链接属于原项目。
- 原始 MIT 许可证及版权声明保留在 [LICENSE](LICENSE)。完整来源和第三方组件说明见 [NOTICE.md](NOTICE.md)。

播放器主要界面、网易云功能、歌词、主题、播放队列，以及桌面版 LX 协议与执行器等来自上游。本仓库的 NAS 适配由维护者借助 OpenAI Codex 协作完成，不代表原作者发布或维护此版本。

## 增加和修改了什么

| 范围 | 本版改动 |
| --- | --- |
| NAS 部署 | 网页、NAS 后端、网易云 API 和搜索组件放在同一个容器中运行，无需电脑常驻，也无需旧桥接服务或柠檬服务。 |
| LX 音源 | 将原版桌面脚本能力适配到网页，支持本地文件和 URL 导入；脚本及选择保存在 NAS 数据目录，多设备读取。 |
| 自动切换 | 可选择参与自动切换的脚本并调整优先级。新配置默认优先 FLAC，再按策略降低到 320k、128k；保留已有用户的音质选择。 |
| 搜索 | 增加 QQ、酷狗入口，与网易云一起提供歌曲、专辑、歌单、歌手四类搜索及相应歌曲列表。各平台 ID 和解析字段分别保存。 |
| 播放适配 | 增加解析超时、音频探测及同源播放地址，支持 Range 请求，避免把接口错误页当成音频。 |
| 界面 | 手机首页的每日推荐、私人 FM 改为等宽正方形；移除搜索页重复输入框；QQ 封面改为同源加载并提供占位图。 |
| 修复 | 修复所用 API 的扫码登录提示图、侧边栏点击范围、部分旧页面资源加载和设置草稿覆盖音源列表的问题。 |

逐版的新增、修复和未解决事项见 **[NAS 改版记录](CHANGELOG_NAS.md)**。

## Docker 安装

支持带 Docker Compose 的 **Linux x86_64 NAS**。当前固定的搜索运行组件不包含 ARM 版本；ARM NAS 尚未适配。首次构建需要访问 npm、Docker 镜像仓库和 GitHub Releases。

```sh
git clone https://github.com/jhckns001/alger-music-nas.git
cd alger-music-nas
docker compose up -d --build
```

浏览器打开 `http://你的NAS地址:18080/`。容器名为 `alger-music`，容器内端口为 `8080`。如果已有同名容器或端口占用，应先调整本项目配置；以上命令适用于新安装。

仓库目前提供源码构建方式，没有发布可直接拉取的公共成品镜像。

### 配置端口和访问范围

将 `.env.example` 复制为 `.env`，按需修改后重新启动：

```dotenv
ALGER_PORT=18080
NAS_BIND_IP=0.0.0.0
TZ=Asia/Shanghai
NAS_REQUIRE_AUTH=0
NAS_ACCESS_KEY=
```

`NAS_BIND_IP` 控制监听地址。默认无需为音源设置访问密钥；若需要限制 NAS 接口访问，设置 `NAS_REQUIRE_AUTH=1` 和自己的 `NAS_ACCESS_KEY`。详细行为见 [NAS 部署说明](NAS说明.md)。

### 导入音源

打开设置中的音源配置，进入“洛雪音源”，导入自己的脚本，再启用需要的脚本、设置音源优先级及音质。脚本须支持对应平台和请求音质；能搜到歌曲不代表已导入脚本一定能解析该歌曲。

网页请求由 NAS 转发。某些只适用于桌面特有接口的脚本可能仍需适配，不承诺兼容所有 LX 脚本。

### 更新与备份

```sh
git pull --ff-only
docker compose up -d --build
```

配置保存在 Docker 命名卷的 `/data`，更新时保留该卷。备份服务器端音源与配置：

```sh
docker cp alger-music:/data ./alger-data-backup
```

网易云登录、播放历史及部分界面偏好保存在浏览器中，不全在这个备份里。不要在需要保留配置时执行 `docker compose down -v`。

## 本地开发

使用 Node.js 24。安装依赖时跳过桌面 Electron 下载：

```sh
npm ci --ignore-scripts
npm run build:nas
```

下载并核验搜索组件：

```sh
# NAS / Linux x86_64 构建所用文件
node nas/download-catalog.mjs

# Windows x64 本地预览所用文件
node nas/download-catalog.mjs --platform windows
```

Windows PowerShell 本地启动示例：

```powershell
$env:CATALOG_BIN = "$PWD/nas/bin/tuneweave.exe"
$env:DATA_DIR = "$PWD/nas-data"
$env:PORT = "18087"
npm run start:nas
```

浏览器打开 `http://127.0.0.1:18087/`。Linux 本地预览相应设置 `CATALOG_BIN` 指向 `nas/bin/tuneweave`；建议通过本项目 Dockerfile 提供兼容的 Linux 运行环境。

若 NAS 无法从 GitHub 下载组件，可以先在能联网的电脑执行默认下载命令，再把包含 `nas/bin/tuneweave` 的源码目录上传 NAS 构建。构建会复用通过固定 SHA256 验证的文件。该二进制不提交到源码仓库。

已有检查入口：

```sh
npm run typecheck:web
npm run test:nas
```

## 已知限制

- QQ 搜索曾间歇失败，具体上游原因尚未确定。接口提供有限重试和只读诊断 `/nas/catalog/diagnostics`，不能把一次更换端口后恢复当作已确认的缓存或端口问题。
- 更改地址或端口会改变浏览器站点身份，浏览器内的登录和偏好不会自动迁移。服务器端脚本是否保留取决于是否仍挂载原来的数据卷。
- 音源可用性、曲目匹配和实际音质取决于用户导入的脚本及上游服务；“优先 FLAC”是请求策略，不保证每首歌都有无损资源。
- 此分支的交付目标是 NAS 网页版。保留的上游桌面源码不表示本仓库另行验证或发布了桌面安装包。

## 许可证

延续上游 [MIT License](LICENSE)。原作者和贡献者的版权声明保留。TuneWeave 等组件遵循各自许可证，见 [NOTICE.md](NOTICE.md) 与 `nas/licenses/`。
