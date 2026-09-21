// Launch Chromium, preferring a browser that is already on the machine.
//
// CI images and sandboxes often ship a Chromium whose build number does not match the
// one Playwright's current version expects. Rather than re-downloading ~150MB on every
// run, fall back to any Chromium we can find.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const CANDIDATE_DIRS = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);

export function findChromium() {
  if (process.env.CHROMIUM_EXECUTABLE) return process.env.CHROMIUM_EXECUTABLE;
  for (const root of CANDIDATE_DIRS) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse();
    for (const d of dirs) {
      const exe = path.join(root, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null; // let Playwright use its own managed download
}

export async function launch(options = {}) {
  const executablePath = findChromium();
  try {
    return await chromium.launch({ ...options, ...(executablePath ? { executablePath } : {}) });
  } catch (err) {
    if (!executablePath) throw err;
    return chromium.launch(options);
  }
}
