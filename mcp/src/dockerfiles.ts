const NGINX = `server {
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

export type Runtime = "dockerfile" | "node" | "static";

export type RemoteFiles = { dockerfile?: string; nginx?: string; port: number };

/** Files to upload for the runtime the user's AI already chose. */
export function filesForRuntime(runtime: Runtime, hasBuildScript: boolean): RemoteFiles {
  if (runtime === "dockerfile") return { port: 0 };
  if (runtime === "node") return { dockerfile: NODE_SERVER, port: 3000 };
  if (hasBuildScript) return { dockerfile: NODE_STATIC, nginx: NGINX, port: 80 };
  return { dockerfile: PLAIN_STATIC, nginx: NGINX, port: 80 };
}
