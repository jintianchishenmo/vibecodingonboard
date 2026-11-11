/** Shell that installs Docker if needed, builds the upload, and replaces the running container. */
export function deployScript(port: number): string {
  return `set -eu
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | $SUDO sh
fi
$SUDO rm -rf /opt/lz-app
$SUDO mkdir -p /opt/lz-app
$SUDO tar -xzf /tmp/lz-app.tgz -C /opt/lz-app
if [ -f /tmp/lz.Dockerfile ]; then $SUDO cp /tmp/lz.Dockerfile /opt/lz-app/Dockerfile; fi
if [ -f /tmp/lz.nginx.conf ]; then $SUDO cp /tmp/lz.nginx.conf /opt/lz-app/.lz-nginx.conf; fi
$SUDO docker build -t lz-app /opt/lz-app
$SUDO docker rm -f lz-app >/dev/null 2>&1 || true
$SUDO docker run -d --name lz-app --restart unless-stopped -p 80:${port} -e PORT=${port} lz-app
$SUDO docker inspect -f '{{.State.Running}}' lz-app
`;
}

export function logScript(lines: number): string {
  const n = Math.min(Math.max(lines, 1), 200);
  return `if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
$SUDO docker logs --tail ${n} lz-app 2>&1 || true
`;
}
