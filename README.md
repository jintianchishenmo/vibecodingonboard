# landingzone

给用 AI 写完代码、但不会部署的人。

在 Cursor、Claude Code 或其他 AI 编程工具里说一句「帮我部署」。你的 AI 选择云、地域和怎么启动，本机的 MCP 用你自己的 AWS 或阿里云账号开一台小服务器，跑起来，交回一个能打开的网址。你不需要会服务器、Docker、Nginx 或域名。

```
你的 AI 工具 ──stdio──▶ MCP（你的电脑，开源）──▶ 你自己的 AWS Lightsail 或阿里云轻量服务器 ──▶ http://公网IP
```

MCP 只做接口：保存密钥、创建或复用一台机器、放行端口、上传代码、取日志、销毁。看项目、决定地域、规格和启动方式，由你的 AI 来做。

## 开源与商业化

这个仓库是开源的 MCP，许可是 [MIT](mcp/LICENSE)。你可以自由使用、修改和分发它。

托管平台不在这个仓库里，也不开源。账号、额度、由我们代为运行的访问地址，是我们保留的商业服务。我们保留运营这项服务并对其收费的权利。MIT 只覆盖本仓库的 MCP，不覆盖托管服务，也不覆盖 landingzone 作为托管服务的名称。

版权 © 2026 landingzone contributors。

## 使用

密钥只写在你电脑的 `~/.landingzone/`，工具的返回值里不会出现密钥。

1. 把 MCP 加进你的 AI 工具。
2. 把 AWS 或阿里云的 Access Key 交给 AI，让它调用 `set_credentials`。
3. 在项目里说「帮我部署」。

AWS 用 Lightsail，按小时计费，SSH 只对你当前的公网 IP 开放。阿里云用轻量应用服务器，创建时按月预付，防火墙默认开放 22、80、443。`destroy` 会删除 AWS 实例；阿里云这台机器需要你在控制台释放，否则当月费用还在。

先构建：

```bash
cd mcp
npm install
npm run build
```

Claude Code 里把路径换成你机器上 `mcp/dist/index.js` 的绝对路径：

```bash
claude mcp add landingzone -- node "/绝对路径/mcp/dist/index.js"
```

Cursor 或其他 MCP 客户端：

```json
{
  "mcpServers": {
    "landingzone": {
      "command": "node",
      "args": ["/绝对路径/mcp/dist/index.js"]
    }
  }
}
```

## 你的 AI 要填的参数

| 参数 | 含义 |
|---|---|
| `runtime` | `dockerfile`、`node` 或 `static` |
| `port` | 应用监听端口。静态站用 80 |
| `region` | 例如 `ap-southeast-1`、`cn-hongkong` |
| `size` | `micro` 约 1 GiB，`small` 约 2 GiB |

`node` 需要 `package.json` 里有 `start`，并监听 `PORT`。`static` 需要根目录的 `index.html`，或者 `build` 脚本产物在 `dist/`、`build/` 或 `out/`。`dockerfile` 用项目里的 Dockerfile。

单次上传压缩后不超过 50 MB。打包时跳过 `node_modules`、`.git` 和常见构建缓存。

## MCP 接口

| 工具 | 作用 |
|---|---|
| `set_credentials` | 把 AWS 或阿里云的 Access Key 存到本机。返回账号标识，不回显密钥 |
| `deploy` | 创建或复用一台小服务器并运行这个目录。成功返回网址，失败返回短日志 |
| `status` | 查看一台，或不填名字时列出本机记录的应用 |
| `logs` | 容器最近的输出 |
| `open_port` | 在这台机器的防火墙上放行一个 TCP 端口 |
| `destroy` | 删除 AWS 实例，或停止阿里云实例 |

## 开发

需要 Node.js 20 或更高版本。

```bash
cd mcp
npm install
npm test
```

## 许可

[MIT](mcp/LICENSE)。托管平台不在此许可内。
