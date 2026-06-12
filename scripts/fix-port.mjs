// Free port 80 on the VPS (orphan containers / stray web servers), then restart the stack.
import { Client } from 'ssh2';

const script = `
set -e
cd /root/last-fortress
echo "== who holds :80 =="
ss -tlnp | grep ':80 ' || true
docker ps --format '{{.Names}} {{.Ports}}' || true
echo "== removing orphans =="
docker compose down --remove-orphans || true
docker rm -f last-fortress-caddy-1 2>/dev/null || true
systemctl stop nginx 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true
systemctl stop apache2 2>/dev/null || true
systemctl disable apache2 2>/dev/null || true
echo "== starting =="
docker compose up -d
sleep 8
docker compose ps
curl -s -o /dev/null -w "HTTP %{http_code}\\n" http://localhost/
`;

const conn = new Client();
conn.on('ready', () => {
  conn.exec(script, (err, stream) => {
    if (err) { console.error(err); process.exit(1); }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', code => { conn.end(); process.exit(code ?? 0); });
  });
}).on('error', e => { console.error(e.message); process.exit(1); })
  .connect({
    host: process.env.VPS_HOST, username: process.env.VPS_USER ?? 'root',
    password: process.env.VPS_PASS, readyTimeout: 20000,
  });
