// Diagnose the game container: logs, local curl, firewall state.
import { Client } from 'ssh2';

const script = process.env.DIAG_SCRIPT ?? `
docker compose -f /root/last-fortress/docker-compose.yml ps
echo "== game logs =="
docker logs --tail 40 last-fortress-game-1 2>&1
echo "== local curl =="
curl -s -o /dev/null -w "HTTP %{http_code}\\n" --max-time 5 http://localhost/ || true
echo "== firewall =="
ufw status 2>/dev/null || true
iptables -L INPUT -n | head -20 2>/dev/null || true
`;

const conn = new Client();
conn.on('ready', () => {
  conn.exec(script, (err, stream) => {
    if (err) { console.error(err); process.exit(1); }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', code => { conn.end(); process.exit(0); });
  });
}).on('error', e => { console.error(e.message); process.exit(1); })
  .connect({
    host: process.env.VPS_HOST, username: process.env.VPS_USER ?? 'root',
    password: process.env.VPS_PASS, readyTimeout: 20000,
  });
