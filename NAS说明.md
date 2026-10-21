# NAS 部署说明

本分支基于 [Alger / algerkong](https://github.com/algerkong) 的 [AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer) 5.1.0，基线提交 `b15617ce8652e12a4314be66e2c35ff1f7602a10`。NAS 版本为 0.3.3。

## 安装入口

使用仓库根目录的 `compose.yaml`，按 [README](README.md#docker-安装) 构建。`nas/compose.yaml` 提供从子目录使用的同等配置，二者选一个即可。默认容器名 `alger-music`，宿主机端口 `18080`，容器内端口 `8080`。

首次构建下载 Node 镜像、npm 依赖及固定版本 TuneWeave 组件。组件下载地址、大小、SHA256 位于 `nas/catalog-artifacts.json`；下载器校验不通过会停止构建。运行时无需再安装依赖。

前端、网易云 API 和多平台元数据服务在一个容器内启动。内部服务监听回环地址，不需要另行映射搜索服务端口。实例数据保存在 `/data`，默认由 Docker 命名卷保存。

## 音源与账户数据

- 用户自行导入脚本。本仓库和构建镜像均不内置真实音源脚本。
- NAS 保存导入的脚本、音源选择及解析相关设置；浏览器不负责保存这些脚本的通用偏好副本。
- 网易云登录、播放历史及部分界面偏好依赖浏览器存储。不同域名或端口的浏览器数据相互独立。
- 数据卷应单独备份；重建容器时继续使用同一个卷。

## 可选接口密钥

默认 `NAS_REQUIRE_AUTH=0`，无需填写密钥即可导入脚本。适用于已由使用者控制访问范围的部署。

如设置 `NAS_REQUIRE_AUTH=1`，需同时设置非空的 `NAS_ACCESS_KEY`，并在网页的 NAS 访问配置中填写相同的值。此密钥用于本项目的 NAS 接口，不是网易云密码，也不是 LX 音源供应方的密钥。

## 搜索和播放

网易云由所用网易云 API 提供。QQ、酷狗的元数据由 [TuneWeave](https://github.com/MOPELotus/TuneWeave) 提供；播放解析使用用户导入并启用的脚本。搜索成功与脚本解析成功是两个独立步骤。

自动切换按音质和音源优先级尝试，限制单次及总等待时间，并探测返回内容是否为音频。默认优先 FLAC，已保存的音质设置继续保留。

## 排查入口

- `/health`：实例健康状态。
- `/nas/catalog/diagnostics`：最近元数据请求失败的有限诊断，不记录搜索关键词或凭据。
- `docker compose logs --tail=100`：启动与运行日志。

报告问题时提供 NAS 版本、平台、操作步骤和已去除个人数据的错误信息，不要提交音源脚本、Cookie、密钥或数据目录。

## 与上游的区别

完整新增和修改说明见 [CHANGELOG_NAS.md](CHANGELOG_NAS.md)，作者与组件来源见 [NOTICE.md](NOTICE.md)。
