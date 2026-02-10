const fs = require('node:fs');

const TRIM_SLOT = (slot) => slot.replace(/\s*-\s*/g, ' - ').trim();

const parseFromTabFile = (text, sourceFile = 'ORIGINAL-schedule.txt') => text
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, idx) => {
    const parts = line.split(/\t+/);
    if (parts.length < 4) {
      throw new Error(`Line ${idx + 1} in ${sourceFile} does not have 4 tab-separated columns.`);
    }
    const [date, away, home, slot] = parts;
    return { date, away, home, slot: TRIM_SLOT(slot) };
  });

const parseFromLegacyFile = (text, sourceFile = 'pony-schedule.txt') => {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const games = [];
  const datePattern = /^(\d{2}\/\d{2}\/\d{4})(?:\s+(.*))?$/;
  const nextNonEmptyIndex = (start) => {
    for (let i = start; i < lines.length; i += 1) {
      if (lines[i]) {
        return i;
      }
    }
    return -1;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(datePattern);
    if (!match) {
      continue;
    }
    const [, date, awayRaw] = match;
    const away = (awayRaw || '').trim();
    const homeIndex = nextNonEmptyIndex(i + 1);
    const home = homeIndex >= 0 ? lines[homeIndex] : '';
    games.push({ date, away, home });
    i = Math.max(i, homeIndex);
  }

  const timePattern = /\b\d{1,2}:\d{2}[AP]M\s*-\s*\d{1,2}:\d{2}[AP]M\b/g;
  const times = text.match(timePattern) || [];
  const normalizedTimes = times.map(TRIM_SLOT);

  if (normalizedTimes.length !== games.length) {
    throw new Error(`Parsed ${games.length} games but ${normalizedTimes.length} time entries in ${sourceFile}.`);
  }

  games.forEach((game, idx) => {
    game.slot = normalizedTimes[idx] || null;
  });

  return games;
};

const loadSchedule = ({
  primaryFile = 'ORIGINAL-schedule.txt',
  fallbackFile = 'pony-schedule.txt',
} = {}) => {
  const sourceFile = fs.existsSync(primaryFile) ? primaryFile : fallbackFile;
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Neither ${primaryFile} nor ${fallbackFile} exists.`);
  }
  const text = fs.readFileSync(sourceFile, 'utf8');
  const games = sourceFile === primaryFile
    ? parseFromTabFile(text, sourceFile)
    : parseFromLegacyFile(text, sourceFile);
  return { games, sourceFile };
};

module.exports = {
  loadSchedule,
  parseFromTabFile,
  parseFromLegacyFile,
};
