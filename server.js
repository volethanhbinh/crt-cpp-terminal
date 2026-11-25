'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const JOBS_ROOT = path.join(os.tmpdir(), 'crt_cpp_jobs');
const IS_WIN = process.platform === 'win32';
const EXE_NAME = IS_WIN ? 'program.exe' : 'program';
const UNBUF_HEADER_PATH = path.join(JOBS_ROOT, 'crt_unbuf.h');

const ALLOWED_STDS = new Set(['c++11', 'c++14', 'c++17', 'c++20', 'c++23']);
const ALLOWED_OPTS = new Set(['-O0', '-O1', '-O2', '-O3', '-Os']);
const MAX_CODE_BYTES = 128 * 1024;
const COMPILE_TIMEOUT_MS = 12000;
const RUN_TIMEOUT_MS = 5000;
const DEBUG_STEP_TIMEOUT_MS = 4500;
const SESSION_TTL_MS = 10 * 60 * 1000;

fs.mkdirSync(JOBS_ROOT, { recursive: true });
fs.writeFileSync(
  UNBUF_HEADER_PATH,
  `#ifndef CRT_UNBUF_H
#define CRT_UNBUF_H
#include <cstdio>
__attribute__((constructor)) static void __crt_init_unbuf() {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
}
#endif
`,
  'utf8'
);

const activeSessions = new Map();
const activeRuns = new Map();
const INTERACTIVE_RUN_TIMEOUT_MS = 60 * 1000;
const MAX_CONCURRENT_JOBS = 8;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_COMPILE = 25;
const HAS_PRLIMIT = !IS_WIN && process.platform === 'linux' && fs.existsSync('/usr/bin/prlimit');
const rateBuckets = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip, limit = RATE_MAX_COMPILE) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of rateBuckets.entries()) {
    if (now > b.resetAt) rateBuckets.delete(ip);
  }
}, RATE_WINDOW_MS).unref();

function getSafeChildEnv() {
  if (IS_WIN) {
    return {
      PATH: process.env.PATH || '',
      SystemRoot: process.env.SystemRoot || 'C:\\Windows',
      TEMP: process.env.TEMP || os.tmpdir(),
      TMP: process.env.TMP || os.tmpdir(),
    };
  }
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
  };
}

function spawnSandboxedBinary(exePath, cliArgs, cwd) {
  const env = getSafeChildEnv();
  if (HAS_PRLIMIT) {
    return spawn(
      '/usr/bin/prlimit',
      ['--cpu=8', '--as=268435456', '--fsize=5242880', '--nofile=32', '--nproc=32', '--', exePath, ...cliArgs],
      { cwd, env, windowsHide: true }
    );
  }
  return spawn(exePath, cliArgs, { cwd, env, windowsHide: true });
}

function toForwardSlash(p) {
  return String(p || '').replace(/\\/g, '/');
}

function normalizeHexAddr(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/0x[0-9a-fA-F]+/);
  if (!m) return null;
  try {
    const val = BigInt(m[0]);
    if (val === 0n) return '0x0';
    return '0x' + val.toString(16);
  } catch {
    return m[0].toLowerCase();
  }
}

function parseHexBigInt(addr) {
  if (!addr) return null;
  try {
    return BigInt(addr);
  } catch {
    return null;
  }
}

function safeReadFile(filePath, maxBytes = 65536) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const stat = fs.statSync(filePath);
    if (stat.size <= maxBytes) {
      return fs.readFileSync(filePath, 'utf8');
    }
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(maxBytes);
    fs.readSync(fd, buf, 0, maxBytes, 0);
    fs.closeSync(fd);
    return buf.toString('utf8') + '\n... [OUTPUT TRUNCATED AT 64KB]';
  } catch {
    return '';
  }
}

function cleanupDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors on locked handles
  }
}

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(
      cmd,
      args,
      {
        timeout: opts.timeout || 10000,
        maxBuffer: opts.maxBuffer || 2 * 1024 * 1024,
        cwd: opts.cwd,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err && typeof err.code === 'number' ? err.code : err ? -1 : 0,
          killed: !!(err && err.killed),
          signal: err && err.signal ? err.signal : null,
          stdout: stdout || '',
          stderr: stderr || '',
          durationMs: Date.now() - started,
        });
      }
    );
  });
}

function parseCliArgs(argsStr) {
  if (!argsStr || typeof argsStr !== 'string') return [];
  const res = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && quote === '"' && i + 1 < argsStr.length) {
        cur += argsStr[++i];
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur.length > 0) {
        res.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) res.push(cur);
  return res.slice(0, 20);
}

function parseCompilerDiagnostics(stderrText) {
  const diags = [];
  const lines = String(stderrText || '').split(/\r?\n/);
  const re = /^(?:.*[/\\])?main\.cpp:(\d+):(\d+):\s*(error|warning|note|fatal error):\s*(.+)$/i;
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      diags.push({
        line: parseInt(m[1], 10),
        column: parseInt(m[2], 10),
        severity: m[3].toLowerCase().includes('error') ? 'error' : m[3].toLowerCase(),
        message: m[4].trim(),
        raw: line,
      });
    }
  }
  return diags;
}

function analyzeCppSource(code) {
  const lines = String(code || '').split(/\r?\n/);
  const stripped = String(code || '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');

  const newMatches = stripped.match(/\bnew(?:\s*\[\s*\])?\b/g) || [];
  const deleteMatches = stripped.match(/\bdelete(?:\s*\[\s*\])?\b/g) || [];
  const mallocMatches = stripped.match(/\b(?:malloc|calloc|realloc)\s*\(/g) || [];
  const freeMatches = stripped.match(/\bfree\s*\(/g) || [];
  const ptrDeclMatches = stripped.match(/\b(?:int|char|double|float|long|short|bool|void|auto|[A-Z]\w*)\s*\*+\s*[a-zA-Z_]\w*/g) || [];
  const uninitPtrs = [];
  const rawArrays = [];

  lines.forEach((rawLine, idx) => {
    const clean = rawLine.replace(/\/\/.*$/, '').trim();
    if (!clean || clean.startsWith('#')) return;
    if (/^(?:const\s+)?(?:int|char|double|float|long|short|bool|void|[A-Z]\w*)\s*\*+\s*([a-zA-Z_]\w*)\s*;/.test(clean)) {
      uninitPtrs.push({ line: idx + 1, code: clean });
    }
    if (/\b(?:int|char|double|float|long|short|bool|[A-Z]\w*)\s+([a-zA-Z_]\w*)\s*\[\s*\d+\s*\]/.test(clean)) {
      rawArrays.push({ line: idx + 1, code: clean });
    }
  });

  const branchTokens = stripped.match(/\b(?:if|else\s+if|for|while|case|catch|\?\s*[^:]+\s*:)\b|&&|\|\|/g) || [];
  const cyclomaticComplexity = 1 + branchTokens.length;

  const funcNames = [];
  const fnRe = /\b([a-zA-Z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?\{/g;
  let fm;
  while ((fm = fnRe.exec(stripped)) !== null) {
    const name = fm[1];
    if (!['if', 'for', 'while', 'switch', 'catch'].includes(name)) {
      funcNames.push(name);
    }
  }

  let hasRecursion = false;
  for (const fn of funcNames) {
    if (fn === 'main') continue;
    const bodyStart = stripped.indexOf(fn + '(');
    if (bodyStart !== -1) {
      const slice = stripped.slice(bodyStart + fn.length);
      const braceIdx = slice.indexOf('{');
      if (braceIdx !== -1) {
        let depth = 0;
        let endIdx = slice.length;
        for (let i = braceIdx; i < slice.length; i++) {
          if (slice[i] === '{') depth++;
          else if (slice[i] === '}') {
            depth--;
            if (depth === 0) {
              endIdx = i;
              break;
            }
          }
        }
        const body = slice.slice(braceIdx, endIdx);
        if (new RegExp('\\b' + fn + '\\s*\\(').test(body)) {
          hasRecursion = true;
        }
      }
    }
  }

  const warnings = [];
  if (newMatches.length > deleteMatches.length) {
    warnings.push(
      `Potential heap leak: ${newMatches.length} 'new' allocation(s) vs ${deleteMatches.length} 'delete' release(s).`
    );
  }
  if (mallocMatches.length > freeMatches.length) {
    warnings.push(
      `Potential C-heap leak: ${mallocMatches.length} malloc/calloc call(s) vs ${freeMatches.length} free() call(s).`
    );
  }
  if (uninitPtrs.length > 0) {
    warnings.push(
      `Uninitialized pointer declaration(s) at line(s): ${uninitPtrs.map((u) => u.line).join(', ')}.`
    );
  }
  if (warnings.length === 0) {
    warnings.push('No obvious static allocation mismatch detected.');
  }

  return {
    lineCount: lines.length,
    functions: Array.from(new Set(funcNames)),
    newCount: newMatches.length,
    deleteCount: deleteMatches.length,
    mallocCount: mallocMatches.length,
    freeCount: freeMatches.length,
    pointerDeclarations: ptrDeclMatches.length,
    uninitializedPointers: uninitPtrs,
    rawArrays,
    hasRecursion,
    cyclomaticComplexity,
    warnings,
  };
}

async function extractDisassemblyAndSections(exePath, cwd) {
  const [disRes, secRes] = await Promise.all([
    execFileAsync('objdump', ['-d', '-S', '-C', '--no-show-raw-insn', exePath], {
      cwd,
      timeout: 6000,
    }),
    execFileAsync('objdump', ['-h', exePath], { cwd, timeout: 4000 }),
  ]);

  const sections = { text: 0, data: 0, rodata: 0, bss: 0, total: 0 };
  if (secRes.ok) {
    const secLines = secRes.stdout.split(/\r?\n/);
    for (const line of secLines) {
      const m = line.match(/^\s*\d+\s+(\.\S+)\s+([0-9a-fA-F]+)/);
      if (m) {
        const name = m[1];
        const size = parseInt(m[2], 16);
        if (name === '.text') sections.text += size;
        else if (name === '.data') sections.data += size;
        else if (name === '.rdata' || name === '.rodata') sections.rodata += size;
        else if (name === '.bss') sections.bss += size;
      }
    }
    sections.total = sections.text + sections.data + sections.rodata + sections.bss;
  }

  const disassemblyBlocks = [];
  if (disRes.ok) {
    const lines = disRes.stdout.split(/\r?\n/);
    let currentFn = null;
    let capture = false;
    let count = 0;

    for (const line of lines) {
      const fnHeader = line.match(/^([0-9a-fA-F]+)\s+<([^>]+)>:\s*$/);
      if (fnHeader) {
        const fnName = fnHeader[2];
        const isRuntimeStub =
          fnName.startsWith('_') ||
          fnName.startsWith('std::') ||
          fnName.startsWith('__') ||
          fnName.includes('CRT') ||
          fnName.includes('mingw') ||
          fnName.includes('frame_dummy') ||
          fnName.includes('register_tm') ||
          fnName.includes('deregister_tm');
        capture = !isRuntimeStub || fnName === 'main';
        if (capture) {
          currentFn = {
            name: fnName,
            address: '0x' + fnHeader[1].replace(/^0+/, '') || '0x0',
            lines: [],
          };
          disassemblyBlocks.push(currentFn);
        } else {
          currentFn = null;
        }
        continue;
      }

      if (capture && currentFn && count < 420) {
        if (line.trim() !== '') {
          currentFn.lines.push(line);
          count++;
        }
      }
    }
  }

  return {
    sections,
    disassembly: disassemblyBlocks.filter((b) => b.lines.length > 0).slice(0, 12),
  };
}

// ---------- GDB MI2 PARSER ----------

function parseMiRecord(text) {
  let idx = 0;
  const len = text.length;

  function skipWs() {
    while (idx < len && (text[idx] === ' ' || text[idx] === ',')) idx++;
  }

  function parseString() {
    if (text[idx] !== '"') return '';
    idx++; // skip opening "
    let out = '';
    while (idx < len) {
      const ch = text[idx++];
      if (ch === '"') break;
      if (ch === '\\' && idx < len) {
        const esc = text[idx++];
        if (esc === 'n') out += '\n';
        else if (esc === 't') out += '\t';
        else if (esc === 'r') out += '\r';
        else if (esc === '\\') out += '\\';
        else if (esc === '"') out += '"';
        else out += esc;
      } else {
        out += ch;
      }
    }
    return out;
  }

  function parseValue() {
    if (idx >= len) return '';
    const ch = text[idx];
    if (ch === '"') return parseString();
    if (ch === '{') return parseTuple();
    if (ch === '[') return parseList();
    let raw = '';
    while (idx < len && text[idx] !== ',' && text[idx] !== '}' && text[idx] !== ']') {
      raw += text[idx++];
    }
    return raw;
  }

  function parseTuple() {
    const obj = {};
    idx++; // skip '{'
    while (idx < len && text[idx] !== '}') {
      skipWs();
      if (text[idx] === '}') break;
      let key = '';
      while (idx < len && text[idx] !== '=' && text[idx] !== '}' && text[idx] !== ',') {
        key += text[idx++];
      }
      if (text[idx] === '=') {
        idx++;
        obj[key.trim()] = parseValue();
      } else {
        break;
      }
      skipWs();
    }
    if (text[idx] === '}') idx++;
    return obj;
  }

  function parseList() {
    const arr = [];
    idx++; // skip '['
    while (idx < len && text[idx] !== ']') {
      skipWs();
      if (text[idx] === ']') break;
      // Check if list items are key=val pairs or bare values
      const saved = idx;
      let hasKey = false;
      while (idx < len && /[a-zA-Z0-9_-]/.test(text[idx])) idx++;
      if (idx > saved && text[idx] === '=') {
        hasKey = true;
      }
      idx = saved;

      if (hasKey) {
        let key = '';
        while (idx < len && text[idx] !== '=') key += text[idx++];
        idx++; // skip '='
        const val = parseValue();
        arr.push({ [key.trim()]: val });
      } else {
        arr.push(parseValue());
      }
      skipWs();
    }
    if (text[idx] === ']') idx++;
    return arr;
  }

  const result = {};
  while (idx < len) {
    skipWs();
    if (idx >= len) break;
    let key = '';
    while (idx < len && text[idx] !== '=' && text[idx] !== ',') {
      key += text[idx++];
    }
    if (text[idx] === '=') {
      idx++;
      result[key.trim()] = parseValue();
    } else {
      idx++;
    }
  }
  return result;
}

function parseMiLine(line) {
  const m = line.match(/^(\d*)([\^*+=~@&])([a-zA-Z0-9_-]+)?(?:,(.*))?$/);
  if (!m) return null;
  const token = m[1] ? parseInt(m[1], 10) : null;
  const prefix = m[2];
  const cls = m[3] || '';
  const body = m[4] || '';

  if (prefix === '~' || prefix === '@' || prefix === '&') {
    const parsed = parseMiRecord('v=' + line.slice(m[1].length + 1));
    return { token, type: 'stream', prefix, text: parsed.v || '' };
  }

  return {
    token,
    type: prefix === '^' ? 'result' : prefix === '*' ? 'exec' : prefix === '=' ? 'notify' : 'status',
    cls,
    data: body ? parseMiRecord(body) : {},
  };
}

class GdbSession {
  constructor({ id, dir, exePath, code, stdinText, argsText, breakpoints, watches, disassembly, sections, staticAnalysis }) {
    this.id = id;
    this.dir = dir;
    this.exePath = exePath;
    this.code = code;
    this.stdinText = stdinText || '';
    this.argsText = argsText || '';
    this.breakpoints = Array.isArray(breakpoints) ? breakpoints : [];
    this.watches = Array.isArray(watches) ? watches : [];
    this.disassembly = disassembly || [];
    this.sections = sections || { text: 0, data: 0, rodata: 0, bss: 0, total: 0 };
    this.staticAnalysis = staticAnalysis || {};
    this.stdoutFile = path.join(dir, 'inferior_stdout.txt');
    this.stdinFile = path.join(dir, 'inferior_stdin.txt');
    this.nextToken = 100;
    this.pending = new Map();
    this.execWaiter = null;
    this.buffer = '';
    this.exited = false;
    this.exitReason = null;
    this.lastActivity = Date.now();
    this.stepIndex = 0;
    this.consoleLog = [];
    this.prevVarValues = new Map();
    this.proc = null;
  }

  touch() {
    this.lastActivity = Date.now();
  }

  async init() {
    fs.writeFileSync(this.stdinFile, this.stdinText, 'utf8');
    fs.writeFileSync(this.stdoutFile, '', 'utf8');

    const exeForward = toForwardSlash(this.exePath);
    this.proc = spawn('gdb', ['--interpreter=mi2', '-nx', '-q', exeForward], {
      cwd: this.dir,
      env: getSafeChildEnv(),
      windowsHide: true,
    });

    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.stderr.on('data', (chunk) => {
      const txt = chunk.toString('utf8').trim();
      if (txt) this.consoleLog.push(txt);
    });
    this.proc.on('close', (code) => {
      this.exited = true;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.resolve({ cls: 'error', data: { msg: 'GDB process closed' } });
      }
      this.pending.clear();
      if (this.execWaiter) {
        clearTimeout(this.execWaiter.timer);
        const w = this.execWaiter;
        this.execWaiter = null;
        w.resolve({ stopped: true, exited: true, reason: `exited (code ${code})` });
      }
    });

    // Wait briefly for initial GDB prompt
    await this.sendMi('-gdb-set print elements 48', 3000);
    await this.sendMi('-gdb-set print array on', 3000);
    await this.sendMi('-gdb-set print pretty off', 3000);
    await this.sendMi('-gdb-set breakpoint pending on', 3000);

    // Apply user breakpoints or default to main
    await this.syncBreakpoints(this.breakpoints);
    const hasMainBp = await this.sendMi('-break-insert main', 3000);
    if (hasMainBp.cls === 'error') {
      throw new Error('Could not set entry breakpoint on main()');
    }
    this.mainBpId = hasMainBp.data?.bkpt?.number || null;

    // Redirect inferior I/O
    const outFwd = toForwardSlash(this.stdoutFile);
    const inFwd = toForwardSlash(this.stdinFile);
    const argStr = this.argsText ? this.argsText.trim() + ' ' : '';
    const runResult = await this.execAndWait(`run ${argStr}< "${inFwd}" > "${outFwd}" 2>&1`, DEBUG_STEP_TIMEOUT_MS);

    // Remove temporary entry breakpoint if user did not place a breakpoint on that line
    if (this.mainBpId && runResult.frame) {
      const mainLine = parseInt(runResult.frame.line || '0', 10);
      if (!this.breakpoints.includes(mainLine)) {
        await this.sendMi(`-break-delete ${this.mainBpId}`, 2000);
      }
    }

    // If user put breakpoints and wants to skip directly? Usually landing on first line of main is best UX!
    return this.buildState(runResult);
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line === '(gdb)') continue;
      const parsed = parseMiLine(line);
      if (!parsed) continue;

      if (parsed.type === 'stream') {
        if (parsed.prefix === '~' || parsed.prefix === '&') {
          const clean = parsed.text.replace(/\n$/, '');
          if (clean && !clean.startsWith('Reading symbols') && !clean.startsWith('[New Thread')) {
            this.consoleLog.push(clean);
            if (this.consoleLog.length > 60) this.consoleLog.shift();
          }
        }
        continue;
      }

      if (parsed.type === 'result' && parsed.token !== null && this.pending.has(parsed.token)) {
        const entry = this.pending.get(parsed.token);
        this.pending.delete(parsed.token);
        clearTimeout(entry.timer);
        entry.resolve({ cls: parsed.cls, data: parsed.data });
      }

      if (parsed.type === 'exec' && parsed.cls === 'stopped') {
        if (this.execWaiter) {
          clearTimeout(this.execWaiter.timer);
          const w = this.execWaiter;
          this.execWaiter = null;
          const reason = parsed.data.reason || 'stopped';
          const exited = reason.startsWith('exited');
          if (exited) {
            this.exited = true;
            this.exitReason = reason;
          }
          w.resolve({
            stopped: true,
            exited,
            reason,
            signalName: parsed.data['signal-name'] || null,
            signalMeaning: parsed.data['signal-meaning'] || null,
            exitCode: parsed.data['exit-code'] || null,
            frame: parsed.data.frame || null,
          });
        }
      }
    }
  }

  sendMi(cmd, timeoutMs = 3500) {
    if (this.exited || !this.proc || this.proc.killed) {
      return Promise.resolve({ cls: 'error', data: { msg: 'Session ended' } });
    }
    const token = ++this.nextToken;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(token);
        resolve({ cls: 'error', data: { msg: `MI command timeout: ${cmd}` } });
      }, timeoutMs);
      this.pending.set(token, { resolve, timer });
      try {
        this.proc.stdin.write(`${token}${cmd}\n`);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(token);
        resolve({ cls: 'error', data: { msg: e.message } });
      }
    });
  }

  execAndWait(cmd, timeoutMs = DEBUG_STEP_TIMEOUT_MS) {
    if (this.exited || !this.proc || this.proc.killed) {
      return Promise.resolve({ stopped: true, exited: true, reason: this.exitReason || 'exited-normally' });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.execWaiter) {
          this.execWaiter = null;
        }
        this.kill();
        resolve({
          stopped: true,
          exited: true,
          timedOut: true,
          reason: 'timeout',
          signalName: 'TIMEOUT',
          signalMeaning: 'Execution exceeded step time limit (possible infinite loop or blocking stdin)',
        });
      }, timeoutMs);

      this.execWaiter = { resolve, timer };
      try {
        const token = ++this.nextToken;
        this.pending.set(token, {
          timer: setTimeout(() => this.pending.delete(token), timeoutMs),
          resolve: (res) => {
            if (res.cls === 'error' && this.execWaiter) {
              clearTimeout(this.execWaiter.timer);
              const w = this.execWaiter;
              this.execWaiter = null;
              w.resolve({
                stopped: true,
                exited: this.exited,
                reason: 'error',
                errorMsg: res.data?.msg || 'Execution error',
              });
            }
          },
        });
        this.proc.stdin.write(`${token}${cmd}\n`);
      } catch (e) {
        clearTimeout(timer);
        this.execWaiter = null;
        resolve({ stopped: true, exited: true, reason: 'error', errorMsg: e.message });
      }
    });
  }

  isUserFrame(frame) {
    if (!frame) return false;
    const f = String(frame.file || frame.fullname || '').toLowerCase();
    return f.endsWith('main.cpp');
  }

  async stepAction(action) {
    this.touch();
    if (this.exited) {
      return this.buildState({ stopped: true, exited: true, reason: this.exitReason || 'exited-normally' });
    }

    const cmdMap = {
      next: '-exec-next',
      step: '-exec-step',
      finish: '-exec-finish',
      continue: '-exec-continue',
    };
    const miCmd = cmdMap[action] || '-exec-next';
    let stopInfo = await this.execAndWait(miCmd);

    // Filter out STL / CRT startup/teardown frames automatically
    let guard = 0;
    while (!stopInfo.exited && !stopInfo.timedOut && stopInfo.frame && !this.isUserFrame(stopInfo.frame) && guard < 4) {
      guard++;
      if (stopInfo.signalName) break; // keep real crash location visible
      const framesRes = await this.sendMi('-stack-list-frames', 2500);
      const rawStack = framesRes.data?.stack || [];
      const userFrameExists = rawStack.some((item) => {
        const fr = item.frame || item;
        return this.isUserFrame(fr);
      });
      if (userFrameExists) {
        stopInfo = await this.execAndWait('-exec-finish', DEBUG_STEP_TIMEOUT_MS);
      } else {
        stopInfo = await this.execAndWait('-exec-continue', DEBUG_STEP_TIMEOUT_MS);
        break;
      }
    }

    this.stepIndex++;
    return this.buildState(stopInfo);
  }

  async syncBreakpoints(lines) {
    this.breakpoints = Array.isArray(lines)
      ? Array.from(new Set(lines.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0)))
      : [];
    await this.sendMi('-break-delete', 2000);
    const active = [];
    for (const ln of this.breakpoints) {
      const r = await this.sendMi(`-break-insert main.cpp:${ln}`, 2000);
      if (r.cls === 'done' && r.data?.bkpt) {
        active.push({
          number: r.data.bkpt.number,
          line: parseInt(r.data.bkpt.line || ln, 10),
          addr: r.data.bkpt.addr || null,
        });
      }
    }
    return active;
  }

  async evalExpression(expr) {
    this.touch();
    if (!expr || typeof expr !== 'string' || expr.length > 200) {
      return { ok: false, error: 'Invalid expression' };
    }
    const cleanExpr = expr.replace(/[\r\n]/g, ' ').trim();
    const res = await this.sendMi(`-data-evaluate-expression "${cleanExpr.replace(/"/g, '\\"')}"`, 2500);
    if (res.cls === 'done') {
      return { ok: true, value: res.data?.value ?? '' };
    }
    return { ok: false, error: res.data?.msg || 'Cannot evaluate expression' };
  }

  async readMemoryBytes(addrExpr, length = 64) {
    this.touch();
    const safeLen = Math.min(256, Math.max(16, parseInt(length, 10) || 64));
    const cleanExpr = String(addrExpr || '$sp').replace(/[\r\n"]/g, '').trim();
    const res = await this.sendMi(`-data-read-memory-bytes "${cleanExpr}" ${safeLen}`, 2500);
    if (res.cls !== 'done' || !Array.isArray(res.data?.memory) || res.data.memory.length === 0) {
      return { ok: false, error: res.data?.msg || 'Memory read failed', rows: [] };
    }
    const mem = res.data.memory[0];
    const beginHex = normalizeHexAddr(mem.begin) || '0x0';
    const contents = mem.contents || '';
    const rows = [];
    let baseAddr = parseHexBigInt(beginHex) || 0n;

    for (let offset = 0; offset < contents.length; offset += 32) {
      const rowHex = contents.slice(offset, offset + 32);
      const bytes = [];
      let ascii = '';
      for (let i = 0; i < rowHex.length; i += 2) {
        const bHex = rowHex.slice(i, i + 2).toUpperCase();
        bytes.push(bHex);
        const code = parseInt(bHex, 16);
        ascii += code >= 32 && code <= 126 ? String.fromCharCode(code) : '.';
      }
      rows.push({
        address: '0x' + (baseAddr + BigInt(offset / 2)).toString(16),
        bytes,
        ascii,
      });
    }

    return { ok: true, begin: beginHex, rows };
  }

  async buildState(stopInfo) {
    const stdout = safeReadFile(this.stdoutFile);

    if (this.exited || stopInfo.exited) {
      return {
        sessionId: this.id,
        status: stopInfo.timedOut ? 'timeout' : stopInfo.signalName ? 'crashed' : 'exited',
        stepIndex: this.stepIndex,
        reason: stopInfo.reason || 'exited-normally',
        signalName: stopInfo.signalName || null,
        signalMeaning: stopInfo.signalMeaning || null,
        exitCode: stopInfo.exitCode ? parseInt(stopInfo.exitCode, 10) : 0,
        errorMsg: stopInfo.errorMsg || null,
        currentLine: stopInfo.frame?.line ? parseInt(stopInfo.frame.line, 10) : null,
        currentFunc: stopInfo.frame?.func || null,
        currentAddr: stopInfo.frame?.addr || null,
        callStack: [],
        variables: [],
        heapNodes: [],
        watches: [],
        registers: {},
        memoryDump: { begin: null, rows: [] },
        stdout,
        breakpoints: this.breakpoints,
        sections: this.sections,
        staticAnalysis: this.staticAnalysis,
        consoleLog: this.consoleLog.slice(-15),
      };
    }

    // 1. Call Stack + Arguments
    const [framesRes, argsRes, typesRes, valsRes] = await Promise.all([
      this.sendMi('-stack-list-frames', 2500),
      this.sendMi('-stack-list-arguments 1', 2500),
      this.sendMi('-stack-list-variables 2', 2500),
      this.sendMi('-stack-list-variables --all-values', 2500),
    ]);

    const argMap = new Map();
    for (const item of argsRes.data?.['stack-args'] || []) {
      const fr = item.frame || item;
      if (fr && fr.level !== undefined) {
        const list = (fr.args || []).map((a) => `${a.name}=${a.value}`);
        argMap.set(String(fr.level), list.join(', '));
      }
    }

    const callStack = [];
    for (const item of framesRes.data?.stack || []) {
      const fr = item.frame || item;
      const fn = fr.func || '?';
      if (fn.startsWith('__tmainCRTStartup') || fn.startsWith('mainCRTStartup') || fn === '__libc_start_main') continue;
      callStack.push({
        level: parseInt(fr.level || '0', 10),
        func: fn,
        args: argMap.get(String(fr.level)) || '',
        file: fr.file || '',
        line: fr.line ? parseInt(fr.line, 10) : null,
        addr: normalizeHexAddr(fr.addr) || fr.addr || '',
        isUser: this.isUserFrame(fr),
      });
    }

    const topFrame = callStack[0] || {};
    const currentLine = stopInfo.frame?.line ? parseInt(stopInfo.frame.line, 10) : topFrame.line || null;
    const currentFunc = stopInfo.frame?.func || topFrame.func || 'main';
    const currentAddr = normalizeHexAddr(stopInfo.frame?.addr) || topFrame.addr || null;

    // 2. Merge variable types and values
    const valByName = new Map();
    for (const v of valsRes.data?.variables || []) {
      valByName.set(v.name, v.value ?? '');
    }

    const rawVars = typesRes.data?.variables || [];
    const variables = [];

    for (const v of rawVars) {
      const name = v.name;
      const type = v.type || 'auto';
      const value = valByName.has(name) ? valByName.get(name) : v.value ?? '';
      const isPointer = type.includes('*');
      const isReference = !isPointer && type.includes('&');
      const isArray = /\[\d*\]/.test(type);

      const [addrRes, sizeRes] = await Promise.all([
        this.sendMi(`-data-evaluate-expression "&(${name})"`),
        this.sendMi(`-data-evaluate-expression "sizeof(${name})"`),
      ]);

      const address = addrRes.cls === 'done' ? normalizeHexAddr(addrRes.data?.value) : null;
      const size = sizeRes.cls === 'done' ? parseInt(sizeRes.data?.value || '0', 10) : 0;

      let targetAddress = null;
      let derefValue = null;
      let isNull = false;

      if (isPointer) {
        targetAddress = normalizeHexAddr(value);
        isNull = !targetAddress || targetAddress === '0x0';
        if (!isNull) {
          const derefRes = await this.sendMi(`-data-evaluate-expression "*(${name})"`);
          if (derefRes.cls === 'done') {
            derefValue = derefRes.data?.value ?? null;
          } else {
            derefValue = '<invalid/unmapped>';
          }
        }
      }

      const prevVal = this.prevVarValues.get(name);
      const changed = prevVal !== undefined && prevVal !== value;
      this.prevVarValues.set(name, value);

      variables.push({
        name,
        type,
        value,
        address,
        size: Number.isFinite(size) ? size : 0,
        isPointer,
        isReference,
        isArray,
        targetAddress,
        isNull,
        derefValue,
        pointsToVar: null,
        changed,
      });
    }

    // 3. Resolve pointer -> stack variable links AND follow heap pointer chains
    const addrRanges = variables
      .filter((v) => v.address && v.size > 0)
      .map((v) => ({
        name: v.name,
        start: parseHexBigInt(v.address),
        end: parseHexBigInt(v.address) + BigInt(v.size),
      }))
      .filter((r) => r.start !== null);

    function findVarAtAddress(hexAddr) {
      const target = parseHexBigInt(hexAddr);
      if (target === null || target === 0n) return null;
      for (const r of addrRanges) {
        if (target >= r.start && target < r.end) return r.name;
      }
      return null;
    }

    const heapNodes = [];
    const seenHeapAddrs = new Set();

    async function followHeapNode(addrHex, ptrType, labelHint) {
      if (!addrHex || addrHex === '0x0' || seenHeapAddrs.has(addrHex) || heapNodes.length >= 10) {
        return;
      }
      if (findVarAtAddress(addrHex)) return; // Already on stack
      seenHeapAddrs.add(addrHex);

      // Derive base type from pointer type (e.g. "Node *" -> "Node")
      const baseType = ptrType.replace(/\*+$/, '').trim();
      let nodeVal = null;
      let nodeSize = 0;

      if (baseType && baseType !== 'void') {
        const castExpr = `*( (${baseType} *) ${addrHex} )`;
        const [vRes, sRes] = await Promise.all([
          this.sendMi(`-data-evaluate-expression "${castExpr}"`),
          this.sendMi(`-data-evaluate-expression "sizeof(${baseType})"`),
        ]);
        if (vRes.cls === 'done') nodeVal = vRes.data?.value ?? null;
        if (sRes.cls === 'done') nodeSize = parseInt(sRes.data?.value || '0', 10);
      }

      // Extract nested pointer addresses inside struct value e.g. "{val = 10, next = 0x1a2b3c}"
      const nestedLinks = [];
      if (nodeVal) {
        const fieldPtrRe = /([a-zA-Z_]\w*)\s*=\s*(0x[0-9a-fA-F]+)/g;
        let m;
        while ((m = fieldPtrRe.exec(nodeVal)) !== null) {
          const fieldName = m[1];
          const nextAddr = normalizeHexAddr(m[2]);
          if (nextAddr) {
            const stackTarget = findVarAtAddress(nextAddr);
            nestedLinks.push({
              field: fieldName,
              targetAddress: nextAddr,
              isNull: nextAddr === '0x0',
              pointsToVar: stackTarget,
            });
          }
        }
      }

      heapNodes.push({
        address: addrHex,
        type: baseType || 'heap',
        label: labelHint || `${baseType || 'mem'}@${addrHex.slice(-4)}`,
        value: nodeVal ?? '<unreadable>',
        size: Number.isFinite(nodeSize) ? nodeSize : 0,
        links: nestedLinks,
      });

      for (const link of nestedLinks) {
        if (!link.isNull && !link.pointsToVar) {
          await followHeapNode.call(this, link.targetAddress, ptrType, `${baseType}.${link.field}`);
        }
      }
    }

    for (const v of variables) {
      if (v.isPointer && !v.isNull && v.targetAddress) {
        const stackMatch = findVarAtAddress(v.targetAddress);
        if (stackMatch) {
          v.pointsToVar = stackMatch;
        } else {
          await followHeapNode.call(this, v.targetAddress, v.type, `*${v.name}`);
        }
      }
      // Also inspect struct variables that themselves have pointer fields (e.g. Node n1 = {val = 99, next = 0x...})
      if (!v.isPointer && v.value && v.value.includes('0x')) {
        const fieldPtrRe = /([a-zA-Z_]\w*)\s*=\s*(0x[0-9a-fA-F]+)/g;
        let m;
        const memberLinks = [];
        while ((m = fieldPtrRe.exec(v.value)) !== null) {
          const targetAddr = normalizeHexAddr(m[2]);
          if (targetAddr && targetAddr !== '0x0') {
            const stackMatch = findVarAtAddress(targetAddr);
            memberLinks.push({
              field: m[1],
              targetAddress: targetAddr,
              pointsToVar: stackMatch,
            });
            if (!stackMatch) {
              await followHeapNode.call(this, targetAddr, v.type + ' *', `${v.name}.${m[1]}`);
            }
          }
        }
        if (memberLinks.length > 0) v.memberLinks = memberLinks;
      }
    }

    // 4. Watch expressions
    const watches = [];
    for (const expr of this.watches.slice(0, 12)) {
      if (!expr || !String(expr).trim()) continue;
      const r = await this.evalExpression(String(expr));
      watches.push({
        expression: String(expr),
        ok: r.ok,
        value: r.ok ? r.value : r.error,
      });
    }

    // 5. Key CPU registers
    const regNames = ['pc', 'sp', 'fp', 'rax', 'rbx', 'rcx', 'rdx'];
    const registers = {};
    await Promise.all(
      regNames.map(async (reg) => {
        const r = await this.sendMi(`-data-evaluate-expression "$${reg}"`, 1500);
        if (r.cls === 'done' && r.data?.value) {
          registers[reg.toUpperCase()] = normalizeHexAddr(r.data.value) || r.data.value;
        }
      })
    );

    // 6. Stack / Variable Hex Memory Dump
    const dumpAnchor = variables.find((v) => v.address)?.address || '$sp';
    const memoryDump = await this.readMemoryBytes(dumpAnchor, 64);

    return {
      sessionId: this.id,
      status: stopInfo.signalName ? 'crashed' : 'paused',
      stepIndex: this.stepIndex,
      reason: stopInfo.reason || 'paused',
      signalName: stopInfo.signalName || null,
      signalMeaning: stopInfo.signalMeaning || null,
      currentLine,
      currentFunc,
      currentAddr,
      callStack,
      variables,
      heapNodes,
      watches,
      registers,
      memoryDump,
      stdout,
      breakpoints: this.breakpoints,
      sections: this.sections,
      staticAnalysis: this.staticAnalysis,
      consoleLog: this.consoleLog.slice(-15),
    };
  }

  kill() {
    this.exited = true;
    try {
      if (this.proc && !this.proc.killed) {
        this.proc.kill('SIGKILL');
      }
    } catch {
      // ignore
    }
    cleanupDir(this.dir);
    activeSessions.delete(this.id);
  }
}

// Cleanup expired debug sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of activeSessions.entries()) {
    if (now - sess.lastActivity > SESSION_TTL_MS) {
      sess.kill();
    }
  }
}, 60 * 1000).unref();

async function compileCpp({ code, std = 'c++20', opt = '-O0', debug = false }) {
  if (typeof code !== 'string' || code.trim().length === 0) {
    return { ok: false, error: 'Source code cannot be empty.' };
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
    return { ok: false, error: 'Source code exceeds 128KB limit.' };
  }

  const safeStd = ALLOWED_STDS.has(std) ? std : 'c++20';
  const safeOpt = debug ? '-O0' : ALLOWED_OPTS.has(opt) ? opt : '-O0';

  const jobId = crypto.randomBytes(8).toString('hex');
  const dir = path.join(JOBS_ROOT, jobId);
  fs.mkdirSync(dir, { recursive: true });

  const cppPath = path.join(dir, 'main.cpp');
  const exePath = path.join(dir, EXE_NAME);
  fs.writeFileSync(cppPath, code, 'utf8');

  const gppArgs = [
    `-std=${safeStd}`,
    safeOpt,
    '-Wall',
    '-Wextra',
    '-fdiagnostics-color=never',
    '-include',
    UNBUF_HEADER_PATH,
  ];
  if (debug) {
    gppArgs.push('-g', '-fno-omit-frame-pointer');
  }
  gppArgs.push(cppPath, '-o', exePath);

  const compileRes = await execFileAsync('g++', gppArgs, {
    cwd: dir,
    timeout: COMPILE_TIMEOUT_MS,
  });

  const diagnostics = parseCompilerDiagnostics(compileRes.stderr);

  if (!compileRes.ok || !fs.existsSync(exePath)) {
    cleanupDir(dir);
    return {
      ok: false,
      jobId,
      compileTimeMs: compileRes.durationMs,
      compileStderr: compileRes.stderr,
      diagnostics,
      staticAnalysis: analyzeCppSource(code),
    };
  }

  const extra = await extractDisassemblyAndSections(exePath, dir);

  return {
    ok: true,
    jobId,
    dir,
    cppPath,
    exePath,
    compileTimeMs: compileRes.durationMs,
    compileStderr: compileRes.stderr,
    diagnostics,
    disassembly: extra.disassembly,
    sections: extra.sections,
    staticAnalysis: analyzeCppSource(code),
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString('utf8');
      if (raw.length > 512 * 1024) {
        reject(new Error('Request payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(payload);
}

function serveStatic(req, res) {
  const urlPath = (req.url || '/').split('?')[0];
  const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const resolved = path.resolve(PUBLIC_DIR, relPath);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.writeHead(404);
    return res.end('Not Found');
  }
  const ext = path.extname(resolved).toLowerCase();
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  }[ext] || 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(resolved).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const isHeavyRoute =
    req.method === 'POST' &&
    ['/api/compile-run', '/api/run/start', '/api/debug/start', '/api/debug/trace'].includes(urlPath);

  if (isHeavyRoute) {
    const ip = getClientIp(req);
    if (!checkRateLimit(ip, RATE_MAX_COMPILE)) {
      return sendJson(res, 429, {
        ok: false,
        error: 'Rate limit exceeded (max 25 compile/debug requests per minute). Please wait.',
      });
    }
    if (activeSessions.size + activeRuns.size >= MAX_CONCURRENT_JOBS) {
      return sendJson(res, 429, {
        ok: false,
        error: `Server busy (${MAX_CONCURRENT_JOBS} concurrent jobs active). Please retry shortly.`,
      });
    }
  }

  try {
    if (req.method === 'GET' && urlPath === '/api/health') {
      const [gpp, gdb, objdump] = await Promise.all([
        execFileAsync('g++', ['--version'], { timeout: 2500 }),
        execFileAsync('gdb', ['--version'], { timeout: 2500 }),
        execFileAsync('objdump', ['--version'], { timeout: 2500 }),
      ]);
      const memFreeMb = Math.round(os.freemem() / (1024 * 1024));
      const memTotalMb = Math.round(os.totalmem() / (1024 * 1024));
      return sendJson(res, 200, {
        status: 'ONLINE',
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        ramFreeMb: memFreeMb,
        ramTotalMb: memTotalMb,
        tools: {
          gpp: gpp.ok ? gpp.stdout.split(/\r?\n/)[0].trim() : 'MISSING',
          gdb: gdb.ok ? gdb.stdout.split(/\r?\n/)[0].trim() : 'MISSING',
          objdump: objdump.ok ? objdump.stdout.split(/\r?\n/)[0].trim() : 'MISSING',
        },
      });
    }

    if (req.method === 'POST' && urlPath === '/api/compile-run') {
      const body = await readJsonBody(req);
      const compiled = await compileCpp({
        code: body.code,
        std: body.std,
        opt: body.opt,
        debug: true,
      });

      if (!compiled.ok) {
        return sendJson(res, 200, {
          ok: false,
          phase: 'compile',
          compileTimeMs: compiled.compileTimeMs,
          compileStderr: compiled.compileStderr,
          diagnostics: compiled.diagnostics,
          staticAnalysis: compiled.staticAnalysis,
        });
      }

      const cliArgs = parseCliArgs(body.args || '');
      const runStarted = Date.now();
      const runResult = await new Promise((resolve) => {
        const child = spawnSandboxedBinary(compiled.exePath, cliArgs, compiled.dir);
        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
          timedOut = true;
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, RUN_TIMEOUT_MS);

        if (body.stdin) {
          child.stdin.write(String(body.stdin));
        }
        child.stdin.end();

        child.stdout.on('data', (d) => {
          if (stdout.length < 65536) stdout += d.toString('utf8');
        });
        child.stderr.on('data', (d) => {
          if (stderr.length < 65536) stderr += d.toString('utf8');
        });
        child.on('close', (code, signal) => {
          clearTimeout(timer);
          resolve({
            exitCode: code,
            signal,
            timedOut,
            stdout,
            stderr,
            runTimeMs: Date.now() - runStarted,
          });
        });
      });

      cleanupDir(compiled.dir);

      return sendJson(res, 200, {
        ok: !runResult.timedOut && runResult.exitCode === 0,
        phase: 'run',
        compileTimeMs: compiled.compileTimeMs,
        compileStderr: compiled.compileStderr,
        diagnostics: compiled.diagnostics,
        disassembly: compiled.disassembly,
        sections: compiled.sections,
        staticAnalysis: compiled.staticAnalysis,
        ...runResult,
      });
    }

    if (req.method === 'POST' && urlPath === '/api/debug/start') {
      const body = await readJsonBody(req);
      const compiled = await compileCpp({
        code: body.code,
        std: body.std,
        opt: '-O0',
        debug: true,
      });

      if (!compiled.ok) {
        return sendJson(res, 200, {
          ok: false,
          phase: 'compile',
          compileTimeMs: compiled.compileTimeMs,
          compileStderr: compiled.compileStderr,
          diagnostics: compiled.diagnostics,
          staticAnalysis: compiled.staticAnalysis,
        });
      }

      const sessionId = crypto.randomBytes(10).toString('hex');
      const session = new GdbSession({
        id: sessionId,
        dir: compiled.dir,
        exePath: compiled.exePath,
        code: body.code,
        stdinText: body.stdin || '',
        argsText: body.args || '',
        breakpoints: body.breakpoints || [],
        watches: body.watches || [],
        disassembly: compiled.disassembly,
        sections: compiled.sections,
        staticAnalysis: compiled.staticAnalysis,
      });

      activeSessions.set(sessionId, session);
      try {
        const state = await session.init();
        return sendJson(res, 200, {
          ok: true,
          compileTimeMs: compiled.compileTimeMs,
          compileStderr: compiled.compileStderr,
          diagnostics: compiled.diagnostics,
          disassembly: compiled.disassembly,
          state,
        });
      } catch (err) {
        session.kill();
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    if (req.method === 'POST' && urlPath === '/api/debug/action') {
      const body = await readJsonBody(req);
      const session = activeSessions.get(body.sessionId);
      if (!session) {
        return sendJson(res, 404, { ok: false, error: 'Debug session not found or expired.' });
      }

      const action = body.action;
      if (action === 'stop') {
        session.kill();
        return sendJson(res, 200, { ok: true, stopped: true });
      }

      if (action === 'eval') {
        const resEval = await session.evalExpression(body.expression);
        return sendJson(res, 200, { ok: true, eval: resEval });
      }

      if (action === 'memory') {
        const mem = await session.readMemoryBytes(body.address || '$sp', body.length || 64);
        return sendJson(res, 200, { ok: true, memoryDump: mem });
      }

      if (action === 'breakpoints') {
        const active = await session.syncBreakpoints(body.breakpoints || []);
        return sendJson(res, 200, { ok: true, breakpoints: active });
      }

      if (action === 'watches') {
        session.watches = Array.isArray(body.watches) ? body.watches : [];
        const watches = [];
        for (const expr of session.watches.slice(0, 12)) {
          if (!expr || !String(expr).trim()) continue;
          const r = await session.evalExpression(String(expr));
          watches.push({ expression: String(expr), ok: r.ok, value: r.ok ? r.value : r.error });
        }
        return sendJson(res, 200, { ok: true, watches });
      }

      if (['next', 'step', 'finish', 'continue'].includes(action)) {
        if (Array.isArray(body.watches)) {
          session.watches = body.watches;
        }
        const state = await session.stepAction(action);
        if (state.status === 'exited' || state.status === 'timeout') {
          session.kill();
        }
        return sendJson(res, 200, { ok: true, state });
      }

      return sendJson(res, 400, { ok: false, error: 'Unknown debug action' });
    }

    if (req.method === 'POST' && urlPath === '/api/debug/trace') {
      const body = await readJsonBody(req);
      const maxSteps = Math.min(60, Math.max(5, parseInt(body.maxSteps || '45', 10)));
      const compiled = await compileCpp({
        code: body.code,
        std: body.std,
        opt: '-O0',
        debug: true,
      });

      if (!compiled.ok) {
        return sendJson(res, 200, {
          ok: false,
          phase: 'compile',
          compileTimeMs: compiled.compileTimeMs,
          compileStderr: compiled.compileStderr,
          diagnostics: compiled.diagnostics,
          staticAnalysis: compiled.staticAnalysis,
        });
      }

      const sessionId = crypto.randomBytes(10).toString('hex');
      const session = new GdbSession({
        id: sessionId,
        dir: compiled.dir,
        exePath: compiled.exePath,
        code: body.code,
        stdinText: body.stdin || '',
        argsText: body.args || '',
        breakpoints: [],
        watches: body.watches || [],
        disassembly: compiled.disassembly,
        sections: compiled.sections,
        staticAnalysis: compiled.staticAnalysis,
      });

      activeSessions.set(sessionId, session);
      const steps = [];
      try {
        let state = await session.init();
        steps.push(state);

        for (let i = 0; i < maxSteps; i++) {
          if (state.status === 'exited' || state.status === 'timeout' || state.status === 'crashed') {
            break;
          }
          state = await session.stepAction('step');
          steps.push(state);
        }
      } finally {
        session.kill();
      }

      return sendJson(res, 200, {
        ok: true,
        compileTimeMs: compiled.compileTimeMs,
        compileStderr: compiled.compileStderr,
        diagnostics: compiled.diagnostics,
        disassembly: compiled.disassembly,
        sections: compiled.sections,
        staticAnalysis: compiled.staticAnalysis,
        totalSteps: steps.length,
        truncated: steps.length > maxSteps,
        steps,
      });
    }

    // ---------- INTERACTIVE STREAMING RUNNER ----------
    if (req.method === 'POST' && urlPath === '/api/run/start') {
      const body = await readJsonBody(req);
      const compiled = await compileCpp({
        code: body.code,
        std: body.std,
        opt: body.opt,
        debug: true,
      });

      if (!compiled.ok) {
        return sendJson(res, 200, {
          ok: false,
          phase: 'compile',
          compileTimeMs: compiled.compileTimeMs,
          compileStderr: compiled.compileStderr,
          diagnostics: compiled.diagnostics,
          staticAnalysis: compiled.staticAnalysis,
        });
      }

      const runId = crypto.randomBytes(10).toString('hex');
      const cliArgs = parseCliArgs(body.args || '');
      const child = spawnSandboxedBinary(compiled.exePath, cliArgs, compiled.dir);

      const run = {
        id: runId,
        dir: compiled.dir,
        child,
        startedAt: Date.now(),
        buffer: [],
        clients: new Set(),
        closed: false,
        timer: null,
      };
      activeRuns.set(runId, run);

      const emitRunEvent = (event, data) => {
        const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        if (run.buffer.length < 500) {
          run.buffer.push(frame);
        }
        for (const clientRes of run.clients) {
          try {
            clientRes.write(frame);
          } catch {
            // ignore broken pipe
          }
        }
      };

      const resetIdleTimer = () => {
        if (run.timer) clearTimeout(run.timer);
        run.timer = setTimeout(() => {
          if (run.closed) return;
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          emitRunEvent('exit', {
            exitCode: -1,
            timedOut: true,
            runTimeMs: Date.now() - run.startedAt,
          });
          run.closed = true;
          for (const clientRes of run.clients) {
            try { clientRes.end(); } catch {}
          }
          run.clients.clear();
          cleanupDir(run.dir);
          setTimeout(() => activeRuns.delete(runId), 30000).unref();
        }, INTERACTIVE_RUN_TIMEOUT_MS);
      };

      resetIdleTimer();

      child.stdout.on('data', (d) => {
        resetIdleTimer();
        emitRunEvent('stdout', { text: d.toString('utf8') });
      });

      child.stderr.on('data', (d) => {
        resetIdleTimer();
        emitRunEvent('stderr', { text: d.toString('utf8') });
      });

      child.on('close', (code, signal) => {
        if (run.timer) clearTimeout(run.timer);
        if (!run.closed) {
          run.closed = true;
          emitRunEvent('exit', {
            exitCode: code,
            signal: signal || null,
            timedOut: false,
            runTimeMs: Date.now() - run.startedAt,
          });
        }
        for (const clientRes of run.clients) {
          try { clientRes.end(); } catch {}
        }
        run.clients.clear();
        cleanupDir(run.dir);
        setTimeout(() => activeRuns.delete(runId), 30000).unref();
      });

      if (body.stdin && String(body.stdin).length > 0) {
        const pre = String(body.stdin);
        child.stdin.write(pre.endsWith('\n') ? pre : pre + '\n');
      }

      return sendJson(res, 200, {
        ok: true,
        runId,
        compileTimeMs: compiled.compileTimeMs,
        compileStderr: compiled.compileStderr,
        diagnostics: compiled.diagnostics,
        disassembly: compiled.disassembly,
        sections: compiled.sections,
        staticAnalysis: compiled.staticAnalysis,
      });
    }

    if (req.method === 'GET' && urlPath === '/api/run/stream') {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const runId = parsedUrl.searchParams.get('runId');
      const run = activeRuns.get(runId);
      if (!run) {
        return sendJson(res, 404, { ok: false, error: 'Run session not found' });
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });

      for (const frame of run.buffer) {
        res.write(frame);
      }

      if (run.closed) {
        return res.end();
      }

      run.clients.add(res);
      req.on('close', () => {
        run.clients.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/run/input') {
      const body = await readJsonBody(req);
      const run = activeRuns.get(body.runId);
      if (!run || run.closed) {
        return sendJson(res, 404, { ok: false, error: 'Process is not running' });
      }
      if (run.timer) {
        clearTimeout(run.timer);
        run.timer = setTimeout(() => {
          if (!run.closed) {
            try { run.child.kill('SIGKILL'); } catch {}
          }
        }, INTERACTIVE_RUN_TIMEOUT_MS);
      }
      if (body.eof) {
        run.child.stdin.end();
      } else {
        const text = String(body.input ?? '');
        run.child.stdin.write(text.endsWith('\n') ? text : text + '\n');
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && urlPath === '/api/run/stop') {
      const body = await readJsonBody(req);
      const run = activeRuns.get(body.runId);
      if (run && !run.closed) {
        try { run.child.kill('SIGKILL'); } catch {}
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET') {
      return serveStatic(req, res);
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || 'Internal server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`CRT-CPP CYBER TERMINAL listening on http://${HOST}:${PORT}`);
  });
}

module.exports = { server, compileCpp, analyzeCppSource, parseMiRecord };
