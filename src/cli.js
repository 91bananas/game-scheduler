#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { loadSchedule } = require('./parseSchedule');
const {
  DEFAULT_TARGET_SLOT,
  DEFAULT_GAMES_PER_PAIR,
  generateBalancedSchedule,
  summarizeSlotDistribution,
  computeSlotFairness,
  computeHomeAwayBalance,
} = require('./scheduleGenerator');

const commands = new Set(['analyze', 'generate', 'export']);

const DEFAULT_PRIMARY_FILE = 'ORIGINAL-schedule.txt';
const DEFAULT_SLOT_FILE = 'time-slots.txt';
const DEFAULT_LOCK_FILE = 'lock-teams.txt';
const DEFAULT_OUTPUT_DIR = 'generated';
const DEFAULT_OUTPUT_NAME = 'schedule.txt';

const toCamelCase = (key) => key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

const parseFlags = (tokens) => {
  const flags = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const eqIndex = token.indexOf('=');
    const rawKey = token.slice(2, eqIndex > 0 ? eqIndex : undefined);
    const key = toCamelCase(rawKey);
    let value;
    if (eqIndex > 0) {
      value = token.slice(eqIndex + 1);
    } else if (i + 1 < tokens.length && !tokens[i + 1].startsWith('--')) {
      value = tokens[i + 1];
      i += 1;
    } else {
      value = true;
    }
    flags[key] = value;
  }
  return flags;
};

const formatCountsTable = (counts) => {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const width = entries.reduce((acc, [team]) => Math.max(acc, team.length), 0);
  return entries.map(([team, count]) => `${team.padEnd(width)} : ${count}`);
};

const ensureDirectory = (dirPath) => {
  if (!dirPath) {
    return;
  }
  fs.mkdirSync(dirPath, { recursive: true });
};

const suffixOutputFile = (filePath, index) => {
  if (index <= 1) {
    return filePath;
  }
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const ext = path.extname(baseName);
  const nameOnly = ext ? baseName.slice(0, -ext.length) : baseName;
  const suffixed = `${nameOnly}-${index}${ext}`;
  return dir === '.' ? suffixed : path.join(dir, suffixed);
};

const loadTimeSlotPairs = (filePath) => {
  const text = fs.readFileSync(filePath, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => Boolean(line))
    .map(({ line, index }) => {
      const [dateRaw, slotRaw] = line.split('|');
      if (!dateRaw || !slotRaw) {
        throw new Error(`Invalid entry on line ${index + 1}: expected "MM/DD/YYYY|time slot".`);
      }
      return {
        date: dateRaw.trim(),
        slot: slotRaw.trim(),
        index,
      };
    });
};

const loadLockedTeams = (filePath) => {
  const text = fs.readFileSync(filePath, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
};

const buildLockRequirements = ({ games, slots, lockedTeams }) => {
  const requirements = new Map();
  if (!lockedTeams || !lockedTeams.length) {
    return requirements;
  }
  const lockedSet = new Set(lockedTeams);
  const slotIndexByKey = new Map();
  slots.forEach((slot, idx) => {
    const index = slot.index ?? idx;
    slotIndexByKey.set(`${slot.date}|${slot.slot}`, index);
  });
  games.forEach((game) => {
    const key = `${game.date}|${game.slot}`;
    const slotIndex = slotIndexByKey.get(key);
    if (slotIndex == null) {
      return;
    }
    const entry = requirements.get(slotIndex) || { requiredTeams: new Set() };
    let matched = false;
    // Only lock the specific team(s) from lock-teams.txt, not their opponents
    if (lockedSet.has(game.away)) {
      entry.requiredTeams.add(game.away);
      matched = true;
    }
    if (lockedSet.has(game.home)) {
      entry.requiredTeams.add(game.home);
      matched = true;
    }
    if (matched) {
      requirements.set(slotIndex, entry);
    }
  });
  return requirements;
};

const verifyTimeSlots = (games, slotPairs) => {
  const mismatches = [];
  const minLength = Math.min(games.length, slotPairs.length);
  for (let i = 0; i < minLength; i += 1) {
    const game = games[i];
    const expected = slotPairs[i];
    if (game.date !== expected.date || game.slot !== expected.slot) {
      mismatches.push({
        index: i,
        expected,
        actual: { date: game.date, slot: game.slot },
      });
    }
  }
  return {
    expectedCount: slotPairs.length,
    actualCount: games.length,
    mismatches,
    isExact: games.length === slotPairs.length && mismatches.length === 0,
  };
};

const printVerificationReport = ({ slotFile, exists, error, result }) => {
  if (!slotFile) {
    return;
  }
  if (!exists) {
    console.warn(`Time slot file ${slotFile} not found; skipping verification.`);
    return;
  }
  if (error) {
    console.error(`Failed to verify time slots in ${slotFile}: ${error.message}`);
    return;
  }
  const { expectedCount, actualCount, mismatches, isExact } = result;
  const status = isExact ? 'PASS' : 'FAIL';
  console.log(`\nTime slot adherence (${status}): expected ${expectedCount} slots, schedule has ${actualCount}.`);
  if (!mismatches.length && expectedCount === actualCount) {
    console.log('  All dates and slots match time-slots.txt exactly.');
    return;
  }
  if (expectedCount !== actualCount) {
    const delta = actualCount - expectedCount;
    console.log(`  Count mismatch: schedule has ${Math.abs(delta)} ${delta > 0 ? 'extra' : 'missing'} slots.`);
  }
  if (mismatches.length) {
    const preview = mismatches.slice(0, 10);
    console.log(`  Found ${mismatches.length} mismatched slot(s). Showing up to 10:`);
    preview.forEach(({ index, expected, actual }) => {
      console.log(`    #${index + 1}: expected ${expected.date} ${expected.slot} | got ${actual.date} ${actual.slot}`);
    });
  }
};

const verifyAgainstFile = (games, slotFile) => {
  if (!slotFile) {
    return { slotFile: null };
  }
  if (!fs.existsSync(slotFile)) {
    return { slotFile, exists: false };
  }
  try {
    const pairs = loadTimeSlotPairs(slotFile);
    const result = verifyTimeSlots(games, pairs);
    return { slotFile, exists: true, result };
  } catch (error) {
    return { slotFile, exists: true, error };
  }
};

const verifyLockedTeamsMatch = (games, lockFile, slotFile) => {
  if (!lockFile || !fs.existsSync(lockFile)) {
    return { lockFile, exists: false };
  }
  if (!slotFile || !fs.existsSync(slotFile)) {
    return { lockFile, exists: true, error: new Error('Slot file required for lock verification') };
  }
  
  try {
    const lockedTeams = loadLockedTeams(lockFile);
    if (!lockedTeams.length) {
      return { lockFile, exists: true, empty: true };
    }
    
    const slots = loadTimeSlotPairs(slotFile);
    const lockRequirements = buildLockRequirements({ games, slots, lockedTeams });
    const lockedSet = new Set(lockedTeams);
    
    const matches = [];
    const mismatches = [];
    
    // For each slot with lock requirements, verify the schedule matches
    lockRequirements.forEach((requirement, slotIndex) => {
      if (slotIndex >= games.length) {
        return; // Slot beyond schedule length
      }
      
      const game = games[slotIndex];
      const expectedTeams = Array.from(requirement.requiredTeams || []);
      const actualTeams = [];
      
      if (lockedSet.has(game.away)) {
        actualTeams.push(game.away);
      }
      if (lockedSet.has(game.home)) {
        actualTeams.push(game.home);
      }
      
      // Check if all expected teams are present
      const allMatch = expectedTeams.every(team => actualTeams.includes(team));
      
      if (allMatch) {
        matches.push({
          slotIndex,
          date: game.date,
          slot: game.slot,
          teams: expectedTeams,
          game: { away: game.away, home: game.home },
        });
      } else {
        mismatches.push({
          slotIndex,
          date: game.date,
          slot: game.slot,
          expected: expectedTeams,
          actual: actualTeams,
          game: { away: game.away, home: game.home },
        });
      }
    });
    
    return {
      lockFile,
      exists: true,
      lockedTeams,
      lockCount: lockRequirements.size,
      matches,
      mismatches,
      success: mismatches.length === 0,
    };
  } catch (error) {
    return { lockFile, exists: true, error };
  }
};

const printLockedTeamsVerification = (verification) => {
  if (!verification.lockFile) {
    return;
  }
  if (!verification.exists) {
    return; // Silent if file doesn't exist
  }
  if (verification.empty) {
    console.log('\nLocked teams verification: No locked teams defined.');
    return;
  }
  if (verification.error) {
    console.error(`\nFailed to verify locked teams: ${verification.error.message}`);
    return;
  }
  
  const { lockedTeams, lockCount, matches, mismatches, success } = verification;
  const status = success ? 'PASS' : 'FAIL';
  
  console.log(`\nLocked teams verification (${status}):`);
  console.log(`  Locked teams: ${lockedTeams.join(', ')}`);
  console.log(`  Slots with locks: ${lockCount}`);
  console.log(`  Matches: ${matches.length}`);
  console.log(`  Mismatches: ${mismatches.length}`);
  
  if (matches.length > 0 && mismatches.length === 0) {
    console.log('  ✓ All locked teams are in their designated time slots.');
  }
  
  if (mismatches.length > 0) {
    console.log('  ⚠ Found mismatches:');
    mismatches.slice(0, 5).forEach(({ slotIndex, date, slot, expected, actual, game }) => {
      console.log(`    Slot #${slotIndex + 1} (${date} ${slot}):`);
      console.log(`      Expected: ${expected.join(', ')}`);
      console.log(`      Actual: ${actual.length > 0 ? actual.join(', ') : 'none'}`);
      console.log(`      Game: ${game.away} @ ${game.home}`);
    });
    if (mismatches.length > 5) {
      console.log(`    ... and ${mismatches.length - 5} more`);
    }
  }
};

const listScheduleFiles = (dirPath) => {
  if (!dirPath) {
    return [];
  }
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return [];
  }
  return fs.readdirSync(resolved)
    .filter((entry) => entry.toLowerCase().endsWith('.txt'))
    .sort((a, b) => a.localeCompare(b))
    .map((entry) => path.join(resolved, entry));
};

const determineAnalyzeTargets = (flags) => {
  if (flags.input) {
    return [flags.input];
  }
  const directories = [];
  if (flags.dir || flags.directory) {
    directories.push(flags.dir || flags.directory);
  } else {
    directories.push(DEFAULT_OUTPUT_DIR);
  }
  for (const dir of directories) {
    const files = listScheduleFiles(dir);
    if (files.length) {
      return files;
    }
  }
  return [DEFAULT_PRIMARY_FILE];
};

const extractTeams = (games) => {
  const teamSet = new Set();
  games.forEach((game) => {
    if (game.away) {
      teamSet.add(game.away);
    }
    if (game.home) {
      teamSet.add(game.home);
    }
  });
  return Array.from(teamSet).sort((a, b) => a.localeCompare(b));
};

const buildTeamStats = (games) => {
  const stats = new Map();
  const ensure = (team) => {
    if (!team) {
      return null;
    }
    if (!stats.has(team)) {
      stats.set(team, { games: 0, opponents: new Map() });
    }
    return stats.get(team);
  };

  games.forEach((game) => {
    const away = ensure(game.away);
    const home = ensure(game.home);
    if (!away || !home) {
      return;
    }
    away.games += 1;
    home.games += 1;
    away.opponents.set(game.home, (away.opponents.get(game.home) || 0) + 1);
    home.opponents.set(game.away, (home.opponents.get(game.away) || 0) + 1);
  });

  return stats;
};

const verifyOpponentCounts = (teamStats, expectedCount = 3) => {
  const issues = [];
  const teams = Array.from(teamStats.keys()).sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      const teamA = teams[i];
      const teamB = teams[j];
      const countA = teamStats.get(teamA)?.opponents.get(teamB) || 0;
      const countB = teamStats.get(teamB)?.opponents.get(teamA) || 0;
      if (countA !== countB || countA !== expectedCount) {
        issues.push({ teamA, teamB, countA, countB });
      }
    }
  }
  return { issues, expectedCount, totalPairs: (teams.length * (teams.length - 1)) / 2 };
};

const printOpponentVerification = ({ issues, expectedCount, totalPairs }) => {
  if (!totalPairs) {
    console.log('\nOpponent check: no teams found.');
    return;
  }
  if (!issues.length) {
    console.log(`\nOpponent check: PASS — every team pair meets exactly ${expectedCount} time(s).`);
    return;
  }
  console.log(`\nOpponent check: FAIL — ${issues.length} pair(s) deviate from ${expectedCount} games.`);
  issues.slice(0, 10).forEach(({ teamA, teamB, countA, countB }) => {
    console.log(`  ${teamA} vs ${teamB}: A sees ${countA}, B sees ${countB}`);
  });
  if (issues.length > 10) {
    console.log(`  ...and ${issues.length - 10} more pair(s).`);
  }
};

const formatOpponentList = (opponents) => {
  if (!opponents.size) {
    return 'None';
  }
  return Array.from(opponents.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([opponent, count]) => `${opponent}(${count})`)
    .join(', ');
};

const printTeamSummaries = (teamStats) => {
  if (!teamStats.size) {
    console.log('No team data available.');
    return;
  }
  const entries = Array.from(teamStats.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const width = entries.reduce((acc, [team]) => Math.max(acc, team.length), 0);
  console.log('\nTeam summaries:');
  entries.forEach(([team, { games, opponents }]) => {
    const opponentStr = formatOpponentList(opponents);
    console.log(`  ${team.padEnd(width)} : ${String(games).padStart(2)} games | Opponents: ${opponentStr}`);
  });
};

const writeSchedule = (games, outputFile) => {
  ensureDirectory(path.dirname(outputFile));
  const lines = games.map((game) => [game.date, game.away, game.home, game.slot].join('\t'));
  fs.writeFileSync(outputFile, `${lines.join('\n')}\n`, 'utf8');
};

const printAnalysis = (games, targetSlot) => {
  const counts = summarizeSlotDistribution(games, targetSlot);
  const lines = formatCountsTable(counts);
  const fairness = computeSlotFairness(games, targetSlot);
  
  console.log(`Distribution for ${targetSlot}:`);
  if (!lines.length) {
    console.log('  No games currently scheduled in this slot.');
    return;
  }
  lines.forEach((line) => console.log(`  ${line}`));
  
  // Print fairness rating
  const fairnessIcon = fairness.fair ? '✓' : '⚠';
  const fairnessColor = fairness.fair ? '' : '\x1b[31m'; // Red text for unfair
  const resetColor = '\x1b[0m';
  console.log(`\n  ${fairnessColor}${fairnessIcon} Fairness Rating: ${fairness.rating}${resetColor} (range: ${fairness.range}, min: ${fairness.min}, max: ${fairness.max})`);
  
  // Print home/away balance
  console.log('\nHome/Away Balance:');
  const homeAwayBalance = computeHomeAwayBalance(games);
  const balanceEntries = Array.from(homeAwayBalance.entries())
    .sort((a, b) => b[1].diff - a[1].diff || a[0].localeCompare(b[0]));
  
  if (!balanceEntries.length) {
    console.log('  No teams found.');
    return;
  }
  
  balanceEntries.forEach(([team, { home, away, diff }]) => {
    const status = diff === 0 ? '✓' : diff === 1 ? '~' : '⚠';
    console.log(`  ${status} ${team.padEnd(20)} : ${home} home, ${away} away (diff: ${diff})`);
  });
  
  const perfectCount = balanceEntries.filter(([, { diff }]) => diff === 0).length;
  const nearCount = balanceEntries.filter(([, { diff }]) => diff === 1).length;
  const imbalancedCount = balanceEntries.filter(([, { diff }]) => diff > 1).length;
  console.log(`  Summary: ${perfectCount} perfect, ${nearCount} nearly balanced, ${imbalancedCount} imbalanced`);
};

const handleAnalyze = (flags) => {
  const targets = determineAnalyzeTargets(flags);
  const targetSlot = flags.targetSlot || DEFAULT_TARGET_SLOT;
  const slotFile = flags.timeSlots || DEFAULT_SLOT_FILE;
  const lockFile = flags.lockFile || DEFAULT_LOCK_FILE;
  const fallbackFile = flags.fallback || 'pony-schedule.txt';

  targets.forEach((target, idx) => {
    const label = path.relative(process.cwd(), target);
    console.log(`\n[${idx + 1}/${targets.length}] Analyzing ${label}`);
    const { games, sourceFile } = loadSchedule({
      primaryFile: target,
      fallbackFile,
    });
    console.log(`Loaded ${games.length} games from ${sourceFile}`);
    printAnalysis(games, targetSlot);
    const teamStats = buildTeamStats(games);
    printTeamSummaries(teamStats);
    printOpponentVerification(verifyOpponentCounts(teamStats, Number(flags.opponentCount || 3)));
    const verification = verifyAgainstFile(games, slotFile);
    printVerificationReport(verification);
    const lockVerification = verifyLockedTeamsMatch(games, lockFile, slotFile);
    printLockedTeamsVerification(lockVerification);
  });
};

const handleGenerate = (flags) => {
  const { games } = loadSchedule({
    primaryFile: flags.input || DEFAULT_PRIMARY_FILE,
    fallbackFile: flags.fallback || 'pony-schedule.txt',
  });
  const teams = extractTeams(games);
  if (!teams.length) {
    throw new Error('Unable to determine participating teams from the input schedule.');
  }
  const targetSlot = flags.targetSlot || DEFAULT_TARGET_SLOT;
  const scheduleCountRaw = Number(flags.count || flags.schedules || 1);
  const scheduleCount = Number.isFinite(scheduleCountRaw) && scheduleCountRaw > 0
    ? Math.floor(scheduleCountRaw)
    : 1;
  const explicitOutput = flags.output && (flags.output.includes('/') || flags.output.includes(path.sep))
    ? flags.output
    : null;
  const outputDir = flags.outputDir || flags.directory || DEFAULT_OUTPUT_DIR;
  const baseName = flags.output && !explicitOutput ? flags.output : (flags.outputName || DEFAULT_OUTPUT_NAME);
  const outputTemplate = explicitOutput || path.join(outputDir, baseName);
  ensureDirectory(explicitOutput ? path.dirname(outputTemplate) : outputDir);
  const userSeed = flags.seed;
  const autoSeedBase = userSeed ?? `auto-${Date.now()}`;
  const slotFile = flags.timeSlots || DEFAULT_SLOT_FILE;
  if (!fs.existsSync(slotFile)) {
    throw new Error(`Time slot file ${slotFile} not found. Unable to generate schedule.`);
  }
  const slots = loadTimeSlotPairs(slotFile);
  const gamesPerPairRaw = Number(flags.gamesPerPair || DEFAULT_GAMES_PER_PAIR);
  const gamesPerPair = Number.isFinite(gamesPerPairRaw) && gamesPerPairRaw > 0
    ? Math.floor(gamesPerPairRaw)
    : DEFAULT_GAMES_PER_PAIR;
  const maxAttemptsRaw = Number(flags.maxAttempts || flags.iterations || 20);
  const maxAttempts = Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw > 0
    ? Math.floor(maxAttemptsRaw)
    : 20;
  const verbose = Boolean(flags.verbose || flags.v);
  const lockFile = flags.lockFile || DEFAULT_LOCK_FILE;
  let lockRequirements = new Map();
  if (lockFile && fs.existsSync(lockFile)) {
    const lockedTeams = loadLockedTeams(lockFile);
    if (lockedTeams.length) {
      lockRequirements = buildLockRequirements({ games, slots, lockedTeams });
      const matchedTeams = new Set();
      const teamLockCounts = new Map();
      lockRequirements.forEach(({ requiredTeams }) => {
        if (requiredTeams) {
          requiredTeams.forEach((team) => {
            matchedTeams.add(team);
            teamLockCounts.set(team, (teamLockCounts.get(team) || 0) + 1);
          });
        }
      });
      console.log(`Loaded ${matchedTeams.size} locked team(s) covering ${lockRequirements.size} slot(s) from ${lockFile}.`);
      
      // Validate lock feasibility
      const maxGamesPerTeam = gamesPerPair * (teams.length - 1);
      const warnings = [];
      teamLockCounts.forEach((count, team) => {
        if (count > maxGamesPerTeam) {
          warnings.push(
            `  • ${team}: locked to ${count} slots but can only play ${maxGamesPerTeam} games ` +
            `(${teams.length - 1} opponents × ${gamesPerPair} games)`
          );
        }
      });
      
      if (warnings.length) {
        console.error('\n⚠ LOCK FEASIBILITY ISSUES:');
        warnings.forEach((w) => console.error(w));
        console.error('\nThe original schedule likely has more games than the generator supports.');
        console.error('Solutions:');
        console.error('  1. Remove teams from lock-teams.txt that appear too often');
        console.error('  2. Use --games-per-pair to match the original schedule\'s opponent frequency');
        console.error('  3. Edit the original schedule to have uniform opponent counts\n');
        throw new Error('Lock requirements exceed generation constraints.');
      }
      
      const missing = lockedTeams.filter((team) => !matchedTeams.has(team));
      if (missing.length) {
        console.warn(`Lock file teams not found in canonical slots: ${missing.join(', ')}`);
      }
    } else {
      console.warn(`Lock file ${lockFile} is empty; proceeding without slot locks.`);
    }
  } else if (flags.lockFile) {
    throw new Error(`Lock file ${lockFile} not found.`);
  }

  for (let idx = 1; idx <= scheduleCount; idx += 1) {
    const derivedSeed = `${autoSeedBase}-${idx}`;
    try {
      const result = generateBalancedSchedule({
        teams,
        slots,
        targetSlot,
        seed: derivedSeed,
        gamesPerPair,
        maxAttempts,
        lockRequirements,
        verbose,
      });
      // Build filename with seed: generated-<seed>-<idx>-<count>.txt
      const dir = path.dirname(outputTemplate);
      const ext = path.extname(outputTemplate);
      const base = path.basename(outputTemplate, ext);
      const seedPart = autoSeedBase.replace(/[^a-zA-Z0-9-]/g, '_');
      const outputFile = path.join(dir, `${base}-${seedPart}-${idx}${ext}`);
      writeSchedule(result.games, outputFile);
      console.log(`\n[${idx}/${scheduleCount}] Wrote generated schedule to ${outputFile}`);
      console.log(`  Seed used: ${result.seed}`);
      console.log(`  Attempts: ${result.attempts}`);
      if (result.homeAwayFlips !== undefined) {
        console.log(`  Home/away balance flips: ${result.homeAwayFlips}`);
      }
      console.log(`  Target slot bounds: min=${result.stats.minTarget}, max=${result.stats.maxTarget}`);
      const distribution = summarizeSlotDistribution(result.games, targetSlot);
      console.log('  Target slot distribution:');
      formatCountsTable(distribution).forEach((line) => console.log(`    ${line}`));
      
      // Display home/away balance
      const homeAwayBalance = computeHomeAwayBalance(result.games);
      const balanceEntries = Array.from(homeAwayBalance.entries())
        .sort((a, b) => b[1].diff - a[1].diff || a[0].localeCompare(b[0]));
      const perfectCount = balanceEntries.filter(([, { diff }]) => diff === 0).length;
      const nearCount = balanceEntries.filter(([, { diff }]) => diff === 1).length;
      const imbalancedCount = balanceEntries.filter(([, { diff }]) => diff > 1).length;
      console.log(`  Home/away balance: ${perfectCount} perfect, ${nearCount} nearly balanced, ${imbalancedCount} imbalanced`);
      if (imbalancedCount > 0) {
        console.log('    Most imbalanced teams:');
        balanceEntries.slice(0, 3).forEach(([team, { home, away, diff }]) => {
          console.log(`      ${team}: ${home} home, ${away} away (diff: ${diff})`);
        });
      }
      
      const teamStats = buildTeamStats(result.games);
      printOpponentVerification(verifyOpponentCounts(teamStats, gamesPerPair));
      const verification = verifyAgainstFile(result.games, slotFile);
      printVerificationReport(verification);
    } catch (error) {
      if (error.failures && error.failures.length) {
        const debugFile = path.join(outputDir, 'generated-err.txt');
        const lastFailure = error.failures[error.failures.length - 1];
        const partial = lastFailure.partialGames || [];
        const lines = [
          `# Generation failed after ${error.failures.length} attempts`,
          `# Last failure: ${lastFailure.reason}`,
          `# Seed: ${lastFailure.seed}`,
          `# Partial schedule (${partial.length}/${slots.length} slots assigned):`,
          '',
        ];
        partial.forEach((game, i) => {
          lines.push(`${game.date}\t${game.away}\t${game.home}\t${game.slot}`);
        });
        if (partial.length < slots.length) {
          lines.push('');
          lines.push(`# Next slot would be: ${slots[partial.length].date} ${slots[partial.length].slot}`);
          const nextLock = lockRequirements.get(slots[partial.length].index ?? partial.length);
          if (nextLock && nextLock.requiredTeams) {
            lines.push(`# Locked to: ${Array.from(nextLock.requiredTeams).join(', ')}`);
          }
        }
        fs.writeFileSync(debugFile, lines.join('\n') + '\n', 'utf8');
        console.error(`\nWrote partial schedule (${partial.length} games) to ${debugFile}`);
      }
      throw error;
    }
  }
};

const handleExport = (flags) => {
  let targets = determineAnalyzeTargets(flags);
  const targetSlot = flags.targetSlot || DEFAULT_TARGET_SLOT;
  const slotFile = flags.timeSlots || DEFAULT_SLOT_FILE;
  const lockFile = flags.lockFile || DEFAULT_LOCK_FILE;
  const fallbackFile = flags.fallback || 'pony-schedule.txt';
  const outputDir = flags.outputDir || flags.dir || 'docs/analysis';
  
  // Always include ORIGINAL-schedule.txt if it exists and not explicitly specified
  if (!flags.input && fs.existsSync(DEFAULT_PRIMARY_FILE)) {
    const originalIncluded = targets.some(t => path.resolve(t) === path.resolve(DEFAULT_PRIMARY_FILE));
    if (!originalIncluded) {
      targets = [DEFAULT_PRIMARY_FILE, ...targets];
    }
  }
  
  ensureDirectory(outputDir);
  
  const results = [];
  const skipped = [];
  
  targets.forEach((target, idx) => {
    const label = path.relative(process.cwd(), target);
    const fileName = path.basename(target, path.extname(target));
    
    console.log(`[${idx + 1}/${targets.length}] Exporting ${label}...`);
    
    try {
      const { games, sourceFile } = loadSchedule({
        primaryFile: target,
        fallbackFile,
      });
      
      const teamStats = buildTeamStats(games);
      const homeAwayBalance = computeHomeAwayBalance(games);
      const targetDistribution = summarizeSlotDistribution(games, targetSlot);
      const slotFairness = computeSlotFairness(games, targetSlot);
      const opponentVerification = verifyOpponentCounts(teamStats, Number(flags.opponentCount || 3));
      const slotVerification = verifyAgainstFile(games, slotFile);
      const lockVerification = verifyLockedTeamsMatch(games, lockFile, slotFile);
    
    // Convert Maps to objects for JSON serialization
    const teams = extractTeams(games);
    const teamStatsObj = {};
    teams.forEach((team) => {
      const stat = teamStats.get(team);
      if (stat) {
        teamStatsObj[team] = {
          games: stat.games,
          opponents: Object.fromEntries(stat.opponents),
        };
      }
    });
    
    const homeAwayBalanceObj = {};
    homeAwayBalance.forEach((balance, team) => {
      homeAwayBalanceObj[team] = balance;
    });
    
    const analysis = {
      fileName,
      sourceFile: path.relative(process.cwd(), target),
      generatedAt: new Date().toISOString(),
      gameCount: games.length,
      teams,
      targetSlot,
      games,
      targetDistribution,
      slotFairness,
      homeAwayBalance: homeAwayBalanceObj,
      teamStats: teamStatsObj,
      opponentVerification: {
        expectedCount: opponentVerification.expectedCount,
        totalPairs: opponentVerification.totalPairs,
        issueCount: opponentVerification.issues.length,
        issues: opponentVerification.issues,
      },
      slotVerification: slotVerification.result ? {
        expectedCount: slotVerification.result.expectedCount,
        actualCount: slotVerification.result.actualCount,
        mismatchCount: slotVerification.result.mismatches.length,
        isExact: slotVerification.result.isExact,
        mismatches: slotVerification.result.mismatches,
      } : null,
      lockVerification: lockVerification.success !== undefined ? {
        lockedTeams: lockVerification.lockedTeams,
        lockCount: lockVerification.lockCount,
        matchCount: lockVerification.matches?.length || 0,
        mismatchCount: lockVerification.mismatches?.length || 0,
        success: lockVerification.success,
        mismatches: lockVerification.mismatches,
      } : null,
    };
    
    const outputFile = path.join(outputDir, `${fileName}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(analysis, null, 2), 'utf8');
    console.log(`  Wrote ${outputFile}`);
    
    results.push({
      fileName,
      sourceFile: analysis.sourceFile,
      outputFile: path.relative(process.cwd(), outputFile),
    });
    } catch (error) {
      console.warn(`  ⚠ Skipped (${error.message})`);
      skipped.push({ fileName, target, error: error.message });
    }
  });
  
  // Create index file listing all analyses
  const indexFile = path.join(outputDir, 'index.json');
  fs.writeFileSync(indexFile, JSON.stringify({ schedules: results, generatedAt: new Date().toISOString() }, null, 2), 'utf8');
  console.log(`\nWrote index to ${indexFile}`);
  console.log(`Exported ${results.length} schedule(s) to ${outputDir}/`);
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} file(s) due to parse errors`);
  }
};

const printHelp = () => {
  console.log('Usage: node src/cli.js <command> [options]');
  console.log('Commands:');
  console.log('  analyze   Analyze existing schedule files');
  console.log('  generate  Build new schedules from canonical slots');
  console.log('  export    Export schedule analysis to JSON for web display');
  console.log('Options:');
  console.log('  --input <file>          Analyze or derive teams from a specific schedule (default ORIGINAL-schedule.txt)');
  console.log('  --dir <directory>       Analyze every .txt schedule in a directory (default generated/)');
  console.log('  --fallback <file>       Fallback legacy schedule file');
  console.log('  --target-slot <slot>    Slot to balance (default 7:00PM - 9:00PM)');
  console.log('  --output <file>         Explicit output file path (overrides directory behavior)');
  console.log('  --output-dir <dir>      Directory for generated schedules (default generated/)');
  console.log('  --output-name <file>    Base file name used inside the output directory (default schedule.txt)');
  console.log('  --count <n>             Number of schedules to generate (default 1)');
  console.log('  --seed <value>          Seed prefix for deterministic generation');
  console.log('  --games-per-pair <n>    Games each opponent pair must play (default 3)');
  console.log('  --max-attempts <n>      Max retries per schedule (default 20)');
  console.log('  --time-slots <file>     Canonical date/time list (default time-slots.txt)');
  console.log('  --lock-file <file>      Teams to keep locked to their original slots (default lock-teams.txt)');
  console.log('  --verbose, -v           Show detailed failure reasons for each attempt');
  console.log('  --opponent-count <n>    Expected games per opponent pair when analyzing (default 3)');
};

const [command = 'analyze', ...rest] = process.argv.slice(2);

if (!commands.has(command)) {
  printHelp();
  process.exit(command ? 1 : 0);
}

const flags = parseFlags(rest);

if (command === 'analyze') {
  handleAnalyze(flags);
} else if (command === 'generate') {
  handleGenerate(flags);
} else if (command === 'export') {
  handleExport(flags);
}
