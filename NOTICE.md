# 作者、来源与许可证

## 原始播放器

- 原作者：[Alger / algerkong](https://github.com/algerkong)
- 原始项目：[algerkong/AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer)
- 本改版基线：上游 `5.1.0`，提交 `b15617ce8652e12a4314be66e2c35ff1f7602a10`。
- 原始 MIT 许可证及 `Copyright (c) 2026 Alger` 保持原文，见根目录 [LICENSE](LICENSE)。
- 仓库保留上游提交历史。本项目不是原作者发布的官方 NAS 版本，也不代表原作者维护或背书。

原版的播放器界面、网易云功能、播放队列、歌词、主题，以及桌面版 LX 脚本协议与执行器等均来自上游。NAS 改动范围见 [CHANGELOG_NAS.md](CHANGELOG_NAS.md)，不能将原版已有功能视作本项目独立原创。

## NAS 适配

NAS 适配由本仓库维护者借助 OpenAI Codex 协作完成，延续 MIT 许可。修改内容与原始播放器的署名分别说明，不替代上游作者及贡献者的权利。

## 第三方运行组件

- [MOPELotus/TuneWeave](https://github.com/MOPELotus/TuneWeave)：使用官方 `1.0.0-beta.1` 的 `tuneweave-http-v1` 运行组件提供 QQ、酷狗元数据。采用 MIT / Apache-2.0 双许可证；原许可和第三方声明保存在 `nas/licenses/TuneWeave/`。构建时下载官方二进制，并核对固定 SHA256。
- `netease-cloud-music-api-alger@4.32.0`：提供网易云 API，通过 npm 安装，版本由 `nas/runtime/package-lock.json` 锁定。
- `nas/ca-bundle.crt` 来自 Node.js 24 内置的公共根证书集合，用于精简镜像中的 HTTPS 验证；没有关闭 TLS 证书验证。
- 前端和其他 npm 依赖沿用各自许可证；依赖清单与锁文件保留在仓库中。

## 音源脚本

本仓库不内置、不分发用户的真实音源脚本，不提供音源下载地址。用户自行导入的脚本、账号信息、访问密钥、运行数据和日志不属于公开源码。测试夹具仅用于模拟行为，不是可用于获取音乐的真实音源服务。
