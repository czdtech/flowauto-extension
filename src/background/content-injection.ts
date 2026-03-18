function getContentScriptFilesFromManifest(): string[] {
  const manifest = chrome.runtime.getManifest();
  const entries = manifest.content_scripts ?? [];
  const files: string[] = [];

  for (const e of entries) {
    if (Array.isArray(e?.js)) files.push(...e.js);
  }

  // Dedupe while preserving order.
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const f of files) {
    if (!f || typeof f !== 'string') continue;
    if (seen.has(f)) continue;
    seen.add(f);
    uniq.push(f);
  }
  return uniq;
}

function executeScriptFiles(tabId: number, files: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, files }, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function tryInjectContentScripts(tabId: number): Promise<boolean> {
  try {
    if (!tabId || !chrome.scripting?.executeScript) return false;
    const files = getContentScriptFilesFromManifest();
    if (!files.length) return false;
    await executeScriptFiles(tabId, files);
    return true;
  } catch {
    return false;
  }
}

