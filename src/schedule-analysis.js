const fs = require('node:fs');

const [, , primaryArg, fallbackArg] = process.argv;
const primaryFile = primaryArg || 'ORIGINAL-schedule.txt';
const fallbackFile = fallbackArg || 'pony-schedule.txt';
const sourceFile = fs.existsSync(primaryFile) ? primaryFile : fallbackFile;
if (!fs.existsSync(sourceFile)) {
  console.error(`Unable to find schedule file. Looked for ${primaryFile} and ${fallbackFile}.`);
  process.exit(1);
}
const text = fs.readFileSync(sourceFile, 'utf8');
const csvOutput = sourceFile === primaryFile ? 'schedule.csv' : 'pony-schedule.csv';

const parseFromTabFile = () => text
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean)
  .map((line, idx) => {
    const parts = line.split(/\t+/);
    if (parts.length < 4) {
      throw new Error(`Line ${idx + 1} in ${sourceFile} does not have 4 tab-separated columns.`);
    }
    const [date, away, home, slot] = parts;
    return { date, away, home, slot: slot.replace(/\s*-\s*/, ' - ').trim() };
  });

const parseFromLegacyFile = () => {
  const lines = text.split(/\r?\n/).map(line => line.trim());
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
  const trimSlot = (slot) => slot.replace(/\s*-\s*/, ' - ').trim();
  const normalizedTimes = times.map(trimSlot);

  if (normalizedTimes.length !== games.length) {
    throw new Error(`Parsed ${games.length} games but ${normalizedTimes.length} time entries.`);
  }

  games.forEach((game, idx) => {
    game.slot = normalizedTimes[idx] || null;
  });

  return games;
};

const games = sourceFile === primaryFile ? parseFromTabFile() : parseFromLegacyFile();

const csvEscape = (value) => {
  const safe = value ?? '';
  if (/[",\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
};

const csvLines = [
  ['date', 'away', 'home', 'slot', 'location', 'field'].join(','),
  ...games.map((game) => [
    csvEscape(game.date),
    csvEscape(game.away),
    csvEscape(game.home),
    csvEscape(game.slot || ''),
    csvEscape('Santana Regional'),
    csvEscape('Park / Field 8A'),
  ].join(',')),
];

fs.writeFileSync(csvOutput, csvLines.join('\n'), 'utf8');
console.log(`Wrote structured CSV to ${csvOutput}`);

const parseClock = (clock) => {
  const [, hourStr, minuteStr, period] = clock.match(/(\d{1,2}):(\d{2})([AP]M)/) || [];
  if (!hourStr) {
    return Number.MAX_SAFE_INTEGER;
  }
  let hour = Number(hourStr) % 12;
  if (period === 'PM') {
    hour += 12;
  }
  return hour * 60 + Number(minuteStr);
};

const slotMeta = new Map();
games.forEach((game, idx) => {
  const slot = game.slot || '';
  if (!slot) {
    return;
  }
  if (!slotMeta.has(slot)) {
    slotMeta.set(slot, { slot, firstIndex: idx, startMinutes: parseClock(slot.split(' - ')[0]), count: 0 });
  }
  slotMeta.get(slot).count += 1;
});

const uniqueSlots = Array.from(slotMeta.values()).sort((a, b) => a.startMinutes - b.startMinutes || a.firstIndex - b.firstIndex);

console.log('Available time slots (unique):');
uniqueSlots.forEach(({ slot, count }) => {
  console.log(`- ${slot} (${count} games)`);
});

const targetSlot = '7:00PM - 9:00PM';
const teamCounts = new Map();
const increment = (team) => {
  if (!team) {
    return;
  }
  teamCounts.set(team, (teamCounts.get(team) || 0) + 1);
};

games.forEach((game) => {
  if (game.slot === targetSlot) {
    increment(game.away);
    increment(game.home);
  }
});

const sortedTeams = Array.from(teamCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

console.log('\nDistribution of games in the 7:00PM - 9:00PM slot:');
if (!sortedTeams.length) {
  console.log('No games currently assigned to this slot.');
} else {
  sortedTeams.forEach(([team, count]) => {
    console.log(`- ${team}: ${count}`);
  });
}

// Home/Away balance analysis
const homeCount = new Map();
const awayCount = new Map();

games.forEach((game) => {
  if (game.home) {
    homeCount.set(game.home, (homeCount.get(game.home) || 0) + 1);
  }
  if (game.away) {
    awayCount.set(game.away, (awayCount.get(game.away) || 0) + 1);
  }
});

const allTeams = new Set([...homeCount.keys(), ...awayCount.keys()]);
const homeAwayBalance = [];

allTeams.forEach((team) => {
  const home = homeCount.get(team) || 0;
  const away = awayCount.get(team) || 0;
  const total = home + away;
  const diff = Math.abs(home - away);
  homeAwayBalance.push({ team, home, away, total, diff });
});

homeAwayBalance.sort((a, b) => b.diff - a.diff || a.team.localeCompare(b.team));

console.log('\nHome/Away Balance per Team:');
if (!homeAwayBalance.length) {
  console.log('No teams found.');
} else {
  homeAwayBalance.forEach(({ team, home, away, total, diff }) => {
    const status = diff === 0 ? '✓ balanced' : diff === 1 ? '~ nearly balanced' : `⚠ imbalanced (diff: ${diff})`;
    console.log(`- ${team}: ${home} home, ${away} away (${total} total) ${status}`);
  });
  
  const perfectBalance = homeAwayBalance.filter(({ diff }) => diff === 0).length;
  const nearlyBalanced = homeAwayBalance.filter(({ diff }) => diff === 1).length;
  const imbalanced = homeAwayBalance.filter(({ diff }) => diff > 1).length;
  
  console.log(`\nSummary: ${perfectBalance} perfectly balanced, ${nearlyBalanced} nearly balanced, ${imbalanced} imbalanced`);
}

// Doubleheader detection (teams playing multiple games on same day)
const teamsByDate = new Map();
games.forEach((game) => {
  if (!game.date) return;
  if (!teamsByDate.has(game.date)) {
    teamsByDate.set(game.date, new Map());
  }
  const dateMap = teamsByDate.get(game.date);
  
  if (game.away) {
    dateMap.set(game.away, (dateMap.get(game.away) || 0) + 1);
  }
  if (game.home) {
    dateMap.set(game.home, (dateMap.get(game.home) || 0) + 1);
  }
});

const doubleheaders = [];
teamsByDate.forEach((teamsOnDate, date) => {
  teamsOnDate.forEach((count, team) => {
    if (count > 1) {
      doubleheaders.push({ date, team, games: count });
    }
  });
});

console.log('\n=== Doubleheader Check ===');
if (doubleheaders.length === 0) {
  console.log('✓ No doubleheaders found - no team plays multiple games on the same day');
} else {
  console.log(`⚠ Found ${doubleheaders.length} doubleheader violation(s):`);
  doubleheaders.forEach(({ date, team, games }) => {
    console.log(`  - ${date}: ${team} plays ${games} games`);
  });
}

// Weekly frequency check (teams playing 3+ times in a calendar week)
const getWeekKey = (dateStr) => {
  const [month, day, year] = dateStr.split('/').map(Number);
  const date = new Date(year, month - 1, day);
  // Get the Monday of the week
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

const highFrequencyWeeks = [];
teamsByWeek.forEach((teamsInWeek, weekKey) => {
  teamsInWeek.forEach((count, team) => {
    if (count >= 3) {
      highFrequencyWeeks.push({ week: weekKey, team, games: count });
    }
  });
});

console.log('\n=== Weekly Frequency Check ===');
if (highFrequencyWeeks.length === 0) {
  console.log('✓ All teams play fewer than 3 games per week');
} else {
  console.log(`⚠ Found ${highFrequencyWeeks.length} instance(s) of teams playing 3+ games in a week:`);
  highFrequencyWeeks.forEach(({ week, team, games }) => {
    console.log(`  - Week of ${week}: ${team} plays ${games} games`);
  });
}
