/**
 * Resolve daily-inbox folder name from CLI args.
 * --slug takes precedence over --date (slug is for debug/non-date folders).
 */

export function todayDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseInboxFolderArg(argv, { defaultFolder = todayDateString() } = {}) {
  let folder = defaultFolder;
  let slug = '';
  let date = defaultFolder;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--slug') {
      slug = argv[++i];
      folder = slug;
    }
    if (argv[i] === '--date') {
      date = argv[++i];
      if (!slug) folder = date;
    }
  }

  return { folder, slug, date };
}

export function validateInboxSlug(slug) {
  const value = String(slug || '').trim();
  if (!value) throw new Error('inbox slug is required');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value)) {
    throw new Error(`invalid inbox slug "${value}" (use letters, digits, . _ -)`);
  }
  return value;
}

/** CLI argv pair for pipeline scripts: --date YYYY-MM-DD or --slug name */
export function inboxCliArgs(folder) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(folder)) return ['--date', folder];
  return ['--slug', folder];
}
