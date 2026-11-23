import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_AGENTS } from '../src/registry.js';

export async function syncOfficialIcons(outDir?: string): Promise<{ downloaded: string[]; skipped: string[] }> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = here.endsWith(path.join('dist', 'scripts'))
    ? path.resolve(here, '../..')
    : path.resolve(here, '..');
  const targetDir = outDir ? path.resolve(outDir) : path.join(repoRoot, 'assets', 'mascots');
  fs.mkdirSync(targetDir, { recursive: true });

  const downloaded: string[] = [];
  const skipped: string[] = [];

  await Promise.all(
    Object.values(BUILTIN_AGENTS).map(async (meta) => {
      if (!meta.officialImageUrl) {
        skipped.push(meta.id);
        return;
      }
      const dest = path.join(targetDir, `${meta.mascotKey}.png`);
      try {
        const res = await fetch(meta.officialImageUrl, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) {
          skipped.push(meta.id);
          return;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(dest, buf);
        downloaded.push(dest);
      } catch {
        skipped.push(meta.id);
      }
    }),
  );

  return { downloaded, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncOfficialIcons(process.argv[2])
    .then(({ downloaded, skipped }) => {
      console.log(`Synced ${downloaded.length} official icon(s) (${skipped.length} skipped).`);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
