// One-shot VPS deployer: connects over SSH (password from env), installs
// Docker if missing, clones/updates the repo in /root, writes .env with
// generated secrets, and brings the stack up.
//
// Usage:  VPS_HOST=1.2.3.4 VPS_USER=root VPS_PASS=... node scripts/deploy-vps.mjs
import { Client } from 'ssh2';
import { randomBytes } from 'node:crypto';

const HOST = process.env.VPS_HOST;
const USER = process.env.VPS_USER ?? 'root';
const PASS = process.env.VPS_PASS;
if (!HOST || !PASS) {
  console.error('Set VPS_HOST and VPS_PASS environment variables.');
  process.exit(1);
}

const REPO = 'https://github.com/swaffX/last-fortress.git';
const DIR = '/root/last-fortress';

const script = `
set -e
export DEBIAN_FRONTEND=noninteractive

if ! command -v docker >/dev/null 2>&1; then
  echo "== installing docker =="
  curl -fsSL https://get.docker.com | sh
fi
docker --version
docker compose version

if [ -d "${DIR}/.git" ]; then
  echo "== updating repo =="
  cd ${DIR} && git fetch origin main && git reset --hard origin/main
else
  echo "== cloning repo =="
  git clone ${REPO} ${DIR}
  cd ${DIR}
fi

if [ ! -f ${DIR}/.env ]; then
  echo "== generating secrets =="
  echo "DB_PASSWORD=${randomBytes(18).toString('hex')}" > ${DIR}/.env
  echo "TOKEN_SECRET=${randomBytes(32).toString('hex')}" >> ${DIR}/.env
fi

cd ${DIR}
echo "== building and starting =="
docker compose up -d --build
sleep 8
docker compose ps
echo "== local healthcheck =="
curl -s -o /dev/null -w "HTTP %{http_code}\\n" http://localhost/ || true
`;

const conn = new Client();
conn.on('ready', () => {
  console.log('[ssh] connected');
  conn.exec(script, (err, stream) => {
    if (err) { console.error(err); process.exit(1); }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', code => {
      console.log(`[ssh] exit ${code}`);
      conn.end();
      process.exit(code ?? 0);
    });
  });
}).on('error', e => {
  console.error('[ssh] error:', e.message);
  process.exit(1);
}).connect({ host: HOST, username: USER, password: PASS, readyTimeout: 20000 });
