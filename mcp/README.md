# landingzone-mcp

An MCP server for people who vibe-code an app and do not know how to deploy it.

Tell your AI to deploy the project. It comes back with a URL on a small server in your own AWS or Aliyun account. You do not set up a server, Docker, Nginx, or a domain yourself.

Your AI chooses the cloud, region, size, and how the app starts. This MCP only stores the key, creates or reuses one small machine, opens ports, uploads the folder, and returns the URL or a short log.

AWS uses Lightsail and is billed hourly. SSH is limited to this computer's public IP. Aliyun uses a lightweight application server, prepaid for one month, with ports 22, 80 and 443 open by default. `destroy` deletes the AWS instance. An Aliyun server has to be released in the Aliyun console to stop the charge.

The hosted landingzone service is a separate commercial product and is not in this package. This package is MIT. We keep the right to operate and charge for the hosted service. The MIT grant does not cover that service or the landingzone service name.

## Tools

| Tool | What it does |
|---|---|
| `set_credentials` | Stores an AWS or Aliyun access key on this computer. Returns `{provider, region, account}` and does not echo the secret |
| `deploy` | Creates or reuses one small server and runs the folder. Returns a URL or a short error log |
| `status` | One app, or every app stored on this computer |
| `logs` | Recent output from the running container |
| `open_port` | Opens one TCP port on the server firewall |
| `destroy` | Deletes the AWS instance, or stops the Aliyun instance |

The AI passes `runtime` (`dockerfile`, `node`, or `static`), the listen `port`, and a `region`. `micro` is about 1 GiB and `small` is about 2 GiB.

`node` needs a `start` script that listens on `PORT`. `static` needs `index.html`, or a `build` script that writes `dist/`, `build/`, or `out/`. `dockerfile` uses the project's Dockerfile.

## Setup

```bash
npm install
npm run build
```

Claude Code, with the absolute path of `dist/index.js`:

```bash
claude mcp add landingzone -- node "/absolute/path/to/dist/index.js"
```

Other tools:

```json
{
  "mcpServers": {
    "landingzone": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"]
    }
  }
}
```

No API token. The first time, give your AI the cloud access key and ask it to call `set_credentials`. The key stays in `~/.landingzone/` on this computer.

## What gets uploaded

Everything in the folder except `node_modules`, `.git`, `.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.vercel` and `.DS_Store`. That includes `.env` files. Maximum 50 MB after compression.

## Develop

```bash
npm install
npm test
```

## License

MIT. See [LICENSE](LICENSE).

The hosted platform is not included. landingzone keeps the right to operate that service commercially.
