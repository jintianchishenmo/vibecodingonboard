import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Thrown for problems in the user's project; the message is shown to the user's AI so it can fix them. */
export class ProjectError extends Error {}

const NGINX_CONF = `server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
}
`;

const NODE_SERVER = `FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build --if-present
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
EXPOSE 3000
CMD ["npm", "start"]
`;

const NODE_STATIC = `FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
RUN mkdir -p /out && for d in dist build out; do if [ -f "$d/index.html" ]; then cp -r "$d"/. /out/ && break; fi; done \\
 && test -f /out/index.html || (echo "ERROR: npm run build did not produce dist/, build/ or out/ with an index.html" && exit 1)

FROM nginx:1.27-alpine
COPY .lz-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out /usr/share/nginx/html
`;

const PLAIN_STATIC = `FROM nginx:1.27-alpine
COPY .lz-nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
`;

export type BuildPlan = { kind: "dockerfile" | "node" | "node-static" | "static"; port: number };

/**
 * Works out how to build the project in `dir` and writes a Dockerfile if it has none.
 * Supported: own Dockerfile, Node app with a start script, Node app that builds to static files, plain HTML.
 */
export function prepareBuild(dir: string): BuildPlan {
  const file = (name: string) => join(dir, name);

  if (!existsSync(file(".dockerignore"))) {
    writeFileSync(file(".dockerignore"), "node_modules\n.git\n");
  }

  if (existsSync(file("Dockerfile"))) {
    const expose = /^\s*EXPOSE\s+(\d+)/im.exec(readFileSync(file("Dockerfile"), "utf8"));
    return { kind: "dockerfile", port: expose ? Number(expose[1]) : 3000 };
  }

  if (existsSync(file("package.json"))) {
    let scripts: Record<string, string> = {};
    try {
      scripts = JSON.parse(readFileSync(file("package.json"), "utf8")).scripts ?? {};
    } catch {
      throw new ProjectError("package.json is not valid JSON.");
    }
    if (scripts.start) {
      writeFileSync(file("Dockerfile"), NODE_SERVER);
      return { kind: "node", port: 3000 };
    }
    if (scripts.build) {
      writeFileSync(file("Dockerfile"), NODE_STATIC);
      writeFileSync(file(".lz-nginx.conf"), NGINX_CONF);
      return { kind: "node-static", port: 80 };
    }
    throw new ProjectError(
      'package.json has neither a "start" script (for a server) nor a "build" script (for a static site). Add one and deploy again.',
    );
  }

  if (existsSync(file("index.html"))) {
    writeFileSync(file("Dockerfile"), PLAIN_STATIC);
    writeFileSync(file(".lz-nginx.conf"), NGINX_CONF);
    return { kind: "static", port: 80 };
  }

  throw new ProjectError(
    "Could not tell how to run this project: no Dockerfile, package.json or index.html at the project root. " +
      "Add a Dockerfile (the app must listen on the port in its EXPOSE line), or deploy the folder that contains package.json.",
  );
}
