import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function startCatalogRuntime(dataDir) {
  const binary = process.env.CATALOG_BIN;
  if (!binary) return null;
  if (!existsSync(binary)) throw new Error('多平台搜索运行文件不存在');
  mkdirSync(path.join(dataDir, 'catalog'), { recursive: true });
  const caBundle = fileURLToPath(new URL('./ca-bundle.crt', import.meta.url));
  const child = spawn(binary, [], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env,
    ...(existsSync(caBundle) ? { SSL_CERT_FILE: caBundle } : {}),
    TUNEWEAVE_BIND: '127.0.0.1:17832', TUNEWEAVE_DATA_DIR: path.join(dataDir, 'catalog'),
    TUNEWEAVE_LOG_LEVEL: 'off', TUNEWEAVE_LOG_TO_FILE: 'false' } });
  let error = false;
  let reason = '';
  child.stderr.on('data', bytes => { reason = (reason + String(bytes)).slice(-2000); });
  child.on('error', issue => { error = true; reason = issue.code || issue.message; });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (error || child.exitCode !== null) break;
    try { const response = await fetch('http://127.0.0.1:17832/healthz', { signal: AbortSignal.timeout(300) });
      if (response.ok) return child; } catch { /* Wait for the local child only. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill();
  appendFileSync(path.join(dataDir, 'catalog-startup-error.log'), reason + '\n');
  throw new Error('多平台搜索服务启动失败：' + (reason.replace(/https?:\/\/\S+/g, '[URL]').slice(-600) || `exit=${child.exitCode}, signal=${child.signalCode}`));
}
