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

const verifyScheduleConstraints = (games) => {
  const issues = [];
  
  // Check for doubleheaders (teams playing multiple games on same day)
  const teamsByDate = new Map();
  games.forEach((game, idx) => {
    if (!game.date) return;
    if (!teamsByDate.has(game.date)) {
      teamsByDate.set(game.date, new Map());
    }
    const dateMap = teamsByDate.get(game.date);
    
    if (!dateMap.has(game.away)) {
      dateMap.set(game.away, []);
    }
    if (!dateMap.has(game.home)) {
      dateMap.set(game.home, []);
    }
    
    dateMap.get(game.away).push(idx);
    dateMap.get(game.home).push(idx);
  });
  
  const doubleheaders = [];
  teamsByDate.forEach((teamsOnDate, date) => {
    teamsOnDate.forEach((gameIndices, team) => {
      if (gameIndices.length > 1) {
        doubleheaders.push({
          date,
          team,
          gameCount: gameIndices.length,
          gameIndices,
        });
      }
    });
  });
  
  if (doubleheaders.length > 0) {
    issues.push({
      type: 'doubleheader',
      severity: 'error',
      message: `Found ${doubleheaders.length} doubleheader violation(s)`,
      details: doubleheaders,
    });
  }
  
  // Check for high weekly frequency (3+ games in a week)
  const getWeekKey = (dateStr) => {
    const [month, day, year] = dateStr.split('/').map(Number);
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  };
  
  const teamsByWeek = new Map();
  games.forEach((game) => {
    if (!game.date) return;
    const weekKey = getWeekKey(game.date);
    if (!teamsByWeek.has(weekKey)) {
      teamsByWeek.set(weekKey, new Map());
    }
    const weekMap = teamsByWeek.get(weekKey);
    
    if (game.away) {
      weekMap.set(game.away, (weekMap.get(game.away) || 0) + 1);
    }
    if (game.home) {
      weekMap.set(game.home, (weekMap.get(game.home) || 0) + 1);
    }
  });
  
  const highFrequency = [];
  teamsByWeek.forEach((teamsInWeek, weekKey) => {
    teamsInWeek.forEach((count, team) => {
      if (count >= 3) {
        highFrequency.push({ week: weekKey, team, games: count });
      }
    });
  });
  
  if (highFrequency.length > 0) {
    issues.push({
      type: 'high_frequency',
      severity: 'warning',
      message: `Found ${highFrequency.length} instance(s) of teams playing 3+ games in a week`,
      details: highFrequency,
    });
  }
  
  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    doubleheaders,
    highFrequency,
  };
};

module.exports = {
  loadSchedule,
  parseFromTabFile,
  parseFromLegacyFile,
  verifyScheduleConstraints,
};
