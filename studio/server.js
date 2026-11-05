// The Daily Croak studio: a tiny local server with no dependencies.
// It runs the Swamp workflow, reads its drafts, records decisions and saves images.
//   node studio/server.js   ->   http://localhost:4322

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 4322);
const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const LOCAL_BIN = path.join(os.homedir(), '.local', 'bin');
const SWAMP = path.join(LOCAL_BIN, 'swamp');
const SKIP_FILE = path.join(ROOT, 'models', '@thedarkpriestess', 'daily-croak', 'scout.yaml');
const NAME = /^[\w.-]+$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.ttf': 'font/ttf', '.png': 'image/png' };
let running = false;

function swamp(args, timeout = 300000) {
  return new Promise(resolve => {
    const env = { ...process.env, PATH: `${LOCAL_BIN}:${process.env.PATH}` };
    execFile(SWAMP, args, { cwd: ROOT, env, timeout, maxBuffer: 2e7 }, (error, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`;
      const message = output.match(/Error: (.+)/)?.[1];
      resolve({ ok: !error, stdout, message: message || (error ? 'The Swamp command failed.' : '') });
    });
  });
}

async function latestDrafts() {
  const { ok, stdout } = await swamp(['data', 'query', 'behavior("drafter") && name == "drafts"', '--select', 'content', '--json'], 60000);
  if (!ok) return null;
  return JSON.parse(stdout).results?.[0] ?? null;
}

function approvedHistory() {
  const dir = path.join(ROOT, 'approved');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse()
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function readSkipList() {
  return fs.readFileSync(SKIP_FILE, 'utf8').split('\n').map(l => l.match(/^ {4}- (\S+)$/)?.[1]).filter(Boolean);
}

function writeSkipList(names) {
  const text = fs.readFileSync(SKIP_FILE, 'utf8');
  const lines = text.split('\n');
  const first = lines.findIndex(l => /^ {4}- \S+$/.test(l));
  const kept = lines.filter(l => !/^ {4}- \S+$/.test(l));
  kept.splice(first, 0, ...names.map(n => `    - ${n}`));
  fs.writeFileSync(SKIP_FILE, kept.join('\n'));
}

async function state() {
  const saved = await latestDrafts();
  const drafts = saved?.items ?? [];
  const current = new Set(drafts.map(d => d.builder));
  const history = approvedHistory().filter(d => !current.has(d.builder));
  const imageDir = path.join(ROOT, 'images');
  return {
    draftedAt: saved?.draftedAt ?? null,
    model: saved?.model ?? null,
    dryRun: saved?.dryRun ?? false,
    drafts: [...drafts, ...history],
    skip: readSkipList(),
    imageCount: fs.existsSync(imageDir) ? fs.readdirSync(imageDir).filter(f => f.endsWith('.png')).length : 0,
    running,
  };
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 2e7) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const actions = {
  async '/api/run'() {
    if (running) return [409, { error: 'A run is already in progress.' }];
    running = true;
    try {
      const result = await swamp(['workflow', 'run', 'daily-croak', '--input', 'live=true', '--json']);
      if (!result.ok) return [502, { error: result.message }];
      return [200, { status: JSON.parse(result.stdout).status }];
    } finally {
      running = false;
    }
  },
  async '/api/approve'({ builder, agreed, text }) {
    if (!NAME.test(builder || '')) return [400, { error: 'That builder name is not valid.' }];
    if (agreed !== true) return [400, { error: 'Confirm the builder agreed before approving.' }];
    const args = ['behavior', 'run', 'drafter', 'approve', '--input', `builder=${builder}`, '--input', 'builderAgreed=true'];
    if (text) args.push('--input', `text=${text}`);
    const result = await swamp(args, 60000);
    return result.ok ? [200, { ok: true }] : [400, { error: result.message }];
  },
  async '/api/reject'({ builder, reason }) {
    if (!NAME.test(builder || '')) return [400, { error: 'That builder name is not valid.' }];
    if (!reason?.trim()) return [400, { error: 'Give a reason for rejecting this draft.' }];
    const result = await swamp(['behavior', 'run', 'drafter', 'reject', '--input', `builder=${builder}`, '--input', `reason=${reason.trim()}`], 60000);
    return result.ok ? [200, { ok: true }] : [400, { error: result.message }];
  },
  async '/api/skip'({ add, remove }) {
    const names = readSkipList();
    if (add) {
      if (!NAME.test(add)) return [400, { error: 'Use letters, numbers, dots, dashes or underscores.' }];
      if (!names.includes(add)) writeSkipList([...names, add]);
    }
    if (remove) writeSkipList(names.filter(n => n !== remove));
    return [200, { skip: readSkipList() }];
  },
  async '/api/save'({ name, png }) {
    const safe = String(name).replace(/[^\w.-]/g, '-');
    if (!String(png).startsWith('data:image/png;base64,')) return [400, { error: 'That is not a PNG image.' }];
    const dir = path.join(ROOT, 'images');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${safe}.png`), Buffer.from(png.split(',')[1], 'base64'));
    return [200, { saved: `images/${safe}.png` }];
  },
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (u.pathname === '/api/state') return send(res, 200, await state());
    if (req.method === 'POST') {
      const allowed = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
      if (!allowed.includes(req.headers.origin)) return send(res, 403, { error: 'Requests must come from the studio page.' });
      const action = actions[u.pathname];
      if (!action) return send(res, 404, { error: 'Not found' });
      const [status, body] = await action(await readBody(req));
      return send(res, status, body);
    }
    const file = path.normalize(path.join(HERE, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname)));
    if (!file.startsWith(HERE + path.sep) || file.endsWith('server.js') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`The Daily Croak studio -> http://localhost:${PORT}`));
