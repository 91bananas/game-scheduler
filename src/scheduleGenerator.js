const DEFAULT_TARGET_SLOT = '7:00PM - 9:00PM';
const DEFAULT_GAMES_PER_PAIR = 3;

const hashSeed = (seed) => {
  const str = String(seed);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (Math.imul(h ^ (h >>> 16), 2246822507) ^ (h >>> 13)) >>> 0;
};

const createSeededRng = (seed = Date.now()) => {
  let t = hashSeed(seed);
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const summarizeSlotDistribution = (games, slot = DEFAULT_TARGET_SLOT) => {
  const counts = new Map();
  games.forEach((game) => {
    if (game.slot !== slot) {
      return;
    }
    counts.set(game.away, (counts.get(game.away) || 0) + 1);
    counts.set(game.home, (counts.get(game.home) || 0) + 1);
  });
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
};

const computeSlotFairness = (games, slot = DEFAULT_TARGET_SLOT) => {
  const distribution = summarizeSlotDistribution(games, slot);
  const counts = Object.values(distribution);
  
  if (counts.length === 0) {
    return { rating: 'N/A', range: 0, min: 0, max: 0, mean: 0, stdDev: 0, fair: true };
  }
  
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const range = max - min;
  const mean = counts.reduce((sum, val) => sum + val, 0) / counts.length;
  
  // Calculate standard deviation
  const variance = counts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / counts.length;
  const stdDev = Math.sqrt(variance);
  
  // Fairness rating: range 0-1 = Excellent, 2 = Good, 3+ = Fair/Poor
  let rating = 'Excellent';
  let fair = true;
  
  if (range === 0) {
    rating = 'Perfect';
  } else if (range === 1) {
    rating = 'Excellent';
  } else if (range === 2) {
    rating = 'Good';
  } else if (range === 3) {
    rating = 'Fair';
    fair = false;
  } else {
    rating = 'Poor';
    fair = false;
  }
  
  return { rating, range, min, max, mean: parseFloat(mean.toFixed(2)), stdDev: parseFloat(stdDev.toFixed(2)), fair };
};

const computeHomeAwayBalance = (games) => {
  const homeCount = new Map();
  const awayCount = new Map();
  games.forEach((game) => {
    homeCount.set(game.home, (homeCount.get(game.home) || 0) + 1);
    awayCount.set(game.away, (awayCount.get(game.away) || 0) + 1);
  });
  const teams = new Set([...homeCount.keys(), ...awayCount.keys()]);
  const balance = new Map();
  teams.forEach((team) => {
    const home = homeCount.get(team) || 0;
    const away = awayCount.get(team) || 0;
    balance.set(team, { home, away, diff: Math.abs(home - away) });
  });
  return balance;
};

const optimizeHomeAwayBalance = (games, lockRequirements = new Map(), seed = Date.now(), maxFlips = 100) => {
  const rng = createSeededRng(seed);
  const gamesCopy = games.map((g) => ({ ...g }));
  
  // Build a map of game index to lock info
  const gameLocks = new Map();
  lockRequirements.forEach((lock, slotIndex) => {
    if (slotIndex < gamesCopy.length) {
      gameLocks.set(slotIndex, lock);
    }
  });
  
  let improved = true;
  let flips = 0;
  
  while (improved && flips < maxFlips) {
    improved = false;
    const balance = computeHomeAwayBalance(gamesCopy);
    
    // Calculate total imbalance
    let totalImbalance = 0;
    balance.forEach(({ diff }) => {
      totalImbalance += diff;
    });
    
    if (totalImbalance === 0) {
      break; // Perfect balance achieved
    }
    
    // Find teams with worst imbalance
    const imbalanced = Array.from(balance.entries())
      .filter(([, { diff }]) => diff > 0)
      .sort((a, b) => b[1].diff - a[1].diff);
    
    if (!imbalanced.length) {
      break;
    }
    
    // Try to flip a game involving the most imbalanced team
    for (const [team, { home, away }] of imbalanced) {
      const needsMoreHome = away > home;
      const needsMoreAway = home > away;
      
      // Find a game where this team can be flipped
      const candidates = [];
      gamesCopy.forEach((game, idx) => {
        const lock = gameLocks.get(idx);
        const isLocked = lock && (lock.away || lock.home);
        
        // If locked with specific home/away assignments, skip
        if (isLocked && lock.away && lock.home) {
          return;
        }
        
        // Check if this game involves the team and flipping would help
        if (needsMoreHome && game.away === team) {
          // Team is away, flip to home
          const opponent = game.home;
          const oppBalance = balance.get(opponent);
          if (oppBalance && oppBalance.away > oppBalance.home) {
            return; // Flipping would hurt opponent's balance
          }
          candidates.push({ idx, game, team, toHome: true });
        } else if (needsMoreAway && game.home === team) {
          // Team is home, flip to away
          const opponent = game.away;
          const oppBalance = balance.get(opponent);
          if (oppBalance && oppBalance.home > oppBalance.away) {
            return; // Flipping would hurt opponent's balance
          }
          candidates.push({ idx, game, team, toHome: false });
        }
      });
      
      if (candidates.length > 0) {
        // Pick a random candidate to reduce bias
        const choice = candidates[Math.floor(rng() * candidates.length)];
        const { idx, game } = choice;
        
        // Flip the game
        gamesCopy[idx] = {
          ...game,
          home: game.away,
          away: game.home,
        };
        
        improved = true;
        flips += 1;
        break; // Re-evaluate balance after this flip
      }
    }
  }
  
  return { games: gamesCopy, flips };
};

const verifyNoDoubleheaders = (games) => {
  const teamsByDate = new Map();
  const violations = [];
  
  games.forEach((game, idx) => {
    if (!teamsByDate.has(game.date)) {
      teamsByDate.set(game.date, new Map());
    }
    const dateMap = teamsByDate.get(game.date);
    
    // Track game indices for each team on this date
    if (!dateMap.has(game.away)) {
      dateMap.set(game.away, []);
    }
    if (!dateMap.has(game.home)) {
      dateMap.set(game.home, []);
    }
    
    dateMap.get(game.away).push(idx);
    dateMap.get(game.home).push(idx);
  });
  
  // Check for teams playing multiple games on same day
  teamsByDate.forEach((teamsOnDate, date) => {
    teamsOnDate.forEach((gameIndices, team) => {
      if (gameIndices.length > 1) {
        violations.push({
          date,
          team,
          gameCount: gameIndices.length,
          gameIndices,
        });
      }
    });
  });
  
  return {
    valid: violations.length === 0,
    violations,
  };
};

const computeTargetRange = (teamCount, slotGameCount) => {
  const appearances = slotGameCount * 2;
  const ideal = teamCount ? appearances / teamCount : 0;
  const min = Math.floor(ideal);
  const max = Math.ceil(ideal);
  return { min, max, ideal };
};

const toTeamArray = (teams) => {
  if (!teams) {
    return [];
  }
  if (Array.isArray(teams)) {
    return Array.from(new Set(teams));
  }
  return Array.from(teams);
};

const createPairState = (teams, gamesPerPair) => {
  const sorted = [...teams].sort((a, b) => a.localeCompare(b));
  const pairs = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      pairs.push({
        teams: [sorted[i], sorted[j]],
        remaining: gamesPerPair,
        homeToggle: 0,
      });
    }
  }
  return pairs;
};

const needScore = (count, minTarget) => Math.max(0, minTarget - count);
const projectedExcess = (count, delta, maxTarget) => Math.max(0, (count + delta) - maxTarget);

const getWeekKey = (dateStr) => {
  const [month, day, year] = dateStr.split('/').map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  const monday = new Date(date);
  monday.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
};

const selectPair = ({
  pairs,
  isTargetSlot,
  teamTargetCounts,
  minTarget,
  maxTarget,
  teamGamesRemaining,
  rng,
  requiredTeams,
  diagnostics,
  teamsPlayedToday,
  allLockedTeams,
  teamsThisWeek,
  currentDate,
}) => {
  let bestScore = -Infinity;
  const best = [];
  const forced = Array.isArray(requiredTeams) && requiredTeams.length > 0;
  const rejected = diagnostics ? { noGames: 0, wrongTeams: 0, sameDay: 0, wouldExceed: 0, teamLocked: 0, weekLimit: 0 } : null;
  
  pairs.forEach((entry) => {
    if (entry.remaining <= 0) {
      if (rejected) rejected.noGames++;
      return;
    }
    if (forced && !requiredTeams.every((team) => entry.teams.includes(team))) {
      if (rejected) rejected.wrongTeams++;
      return;
    }
    const [teamA, teamB] = entry.teams;
    
    // CRITICAL: Check if either team already played today - this prevents doubleheaders
    // This check applies to ALL slots, including forced/locked ones
    if (teamsPlayedToday && (teamsPlayedToday.has(teamA) || teamsPlayedToday.has(teamB))) {
      if (rejected) rejected.sameDay++;
      return;
    }
    
    // If this is NOT a forced/locked slot, reject pairs involving globally locked teams
    if (!forced && allLockedTeams) {
      if (allLockedTeams.has(teamA) || allLockedTeams.has(teamB)) {
        if (rejected) rejected.teamLocked++;
        return;
      }
    }
    
    // Check weekly frequency - prefer to keep teams under 3 games per week
    const weeklyCountA = teamsThisWeek ? (teamsThisWeek.get(teamA) || 0) : 0;
    const weeklyCountB = teamsThisWeek ? (teamsThisWeek.get(teamB) || 0) : 0;
    
    // Hard reject if either team would hit 3 games this week (only for non-forced slots)
    if (!forced && (weeklyCountA >= 2 || weeklyCountB >= 2)) {
      if (rejected) rejected.weekLimit++;
      return;
    }
    
    const targetCountA = teamTargetCounts.get(teamA) || 0;
    const targetCountB = teamTargetCounts.get(teamB) || 0;
    const projectedA = projectedExcess(targetCountA, isTargetSlot ? 1 : 0, maxTarget);
    const projectedB = projectedExcess(targetCountB, isTargetSlot ? 1 : 0, maxTarget);
    // For locked slots, allow exceeding maxTarget since teams have no choice
    if (!forced && (projectedA > 0 || projectedB > 0)) {
      if (rejected) rejected.wouldExceed++;
      return;
    }
    const needA = needScore(targetCountA, minTarget);
    const needB = needScore(targetCountB, minTarget);
    const base = entry.remaining;
    const targetScore = isTargetSlot ? (needA + needB) * 3 : (needA + needB) * -0.2;
    const gamesLeft = (teamGamesRemaining.get(teamA) + teamGamesRemaining.get(teamB)) * 0.02;
    
    // Penalty for teams approaching weekly limit
    const weeklyPenalty = (weeklyCountA + weeklyCountB) * -2.0;
    
    const jitter = rng() * 0.05;
    const score = base + targetScore + gamesLeft + weeklyPenalty + jitter;
    if (score > bestScore) {
      bestScore = score;
      best.length = 0;
      best.push(entry);
    } else if (score === bestScore) {
      best.push(entry);
    }
  });
  if (!best.length) {
    if (diagnostics && rejected) {
      diagnostics.rejection = rejected;
      diagnostics.forced = forced;
      diagnostics.requiredTeams = requiredTeams;
      diagnostics.totalPairs = pairs.length;
    }
    return null;
  }
  return best[Math.floor(rng() * best.length)];
};

const assignGame = ({ slot, entry, rng, lock, homeAwayCounts }) => {
  let [teamA, teamB] = entry.teams;
  let away;
  let home;

  if (lock) {
    const required = new Set(lock.requiredTeams || []);
    if (lock.away && lock.home) {
      away = lock.away;
      home = lock.home;
    } else if (lock.away) {
      away = lock.away;
      home = entry.teams.find((team) => team !== lock.away) || lock.away;
    } else if (lock.home) {
      home = lock.home;
      away = entry.teams.find((team) => team !== lock.home) || lock.home;
    } else {
      // Consider home/away balance when no specific lock
      const homeA = homeAwayCounts.home.get(teamA) || 0;
      const awayA = homeAwayCounts.away.get(teamA) || 0;
      const homeB = homeAwayCounts.home.get(teamB) || 0;
      const awayB = homeAwayCounts.away.get(teamB) || 0;
      
      // Prefer assigning team with fewer home games as home
      const balanceScoreA = homeA - awayA; // Positive if more home games
      const balanceScoreB = homeB - awayB;
      
      if (Math.abs(balanceScoreA - balanceScoreB) > 1) {
        // Significant imbalance, prefer better balance
        if (balanceScoreA < balanceScoreB) {
          home = teamA;
          away = teamB;
        } else {
          home = teamB;
          away = teamA;
        }
      } else {
        // Minor or no imbalance, randomize with slight bias toward balance
        const swap = rng() < 0.5;
        away = swap ? teamB : teamA;
        home = swap ? teamA : teamB;
      }
      
      if (required.size === 1) {
        const [req] = required;
        if (away !== req && home === req) {
          [away, home] = [home, away];
        }
      }
    }
  } else {
    // Consider home/away balance when assigning
    const homeA = homeAwayCounts.home.get(teamA) || 0;
    const awayA = homeAwayCounts.away.get(teamA) || 0;
    const homeB = homeAwayCounts.home.get(teamB) || 0;
    const awayB = homeAwayCounts.away.get(teamB) || 0;
    
    const balanceScoreA = homeA - awayA;
    const balanceScoreB = homeB - awayB;
    
    if (Math.abs(balanceScoreA - balanceScoreB) > 1) {
      if (balanceScoreA < balanceScoreB) {
        home = teamA;
        away = teamB;
      } else {
        home = teamB;
        away = teamA;
      }
    } else {
      const swap = rng() < 0.5;
      away = swap ? teamB : teamA;
      home = swap ? teamA : teamB;
    }
  }

  return {
    date: slot.date,
    slot: slot.slot,
    away,
    home,
  };
};

const tryGenerateSchedule = ({
  teams,
  slots,
  targetSlot,
  seed,
  gamesPerPair,
  lockRequirements = new Map(),
  verbose = false,
}) => {
  const rng = createSeededRng(seed);
  const pairs = createPairState(teams, gamesPerPair);
  const teamTargetCounts = new Map(teams.map((team) => [team, 0]));
  const gamesNeededPerTeam = gamesPerPair * (teams.length - 1);
  const teamGamesRemaining = new Map(teams.map((team) => [team, gamesNeededPerTeam]));
  const targetSlots = slots.filter(({ slot }) => slot === targetSlot).length;
  const { min: minTarget, max: maxTarget } = computeTargetRange(teams.length, targetSlots);
  const assignments = [];
  const teamsByDate = new Map();
  const teamsByWeek = new Map();
  
  // Track home/away counts for balance
  const homeAwayCounts = {
    home: new Map(teams.map((team) => [team, 0])),
    away: new Map(teams.map((team) => [team, 0])),
  };
  
  // Build set of all teams that appear in any lock requirement
  const allLockedTeams = new Set();
  lockRequirements.forEach(({ requiredTeams }) => {
    if (requiredTeams) {
      requiredTeams.forEach((team) => allLockedTeams.add(team));
    }
  });

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const slotLock = lockRequirements.get(slot.index ?? i);
    
    // Get or create set of teams that played on this date
    if (!teamsByDate.has(slot.date)) {
      teamsByDate.set(slot.date, new Set());
    }
    const teamsPlayedToday = teamsByDate.get(slot.date);
    
    // Track teams playing this week
    const weekKey = getWeekKey(slot.date);
    if (!teamsByWeek.has(weekKey)) {
      teamsByWeek.set(weekKey, new Map());
    }
    const teamsThisWeek = teamsByWeek.get(weekKey);
    
    const diagnostics = {};
    const candidate = selectPair({
      pairs,
      isTargetSlot: slot.slot === targetSlot,
      teamTargetCounts,
      minTarget,
      maxTarget,
      teamGamesRemaining,
      rng,
      requiredTeams: slotLock ? Array.from(slotLock.requiredTeams || []) : null,
      diagnostics: verbose ? diagnostics : null,
      teamsPlayedToday,
      allLockedTeams: allLockedTeams.size > 0 ? allLockedTeams : null,
      teamsThisWeek,
      currentDate: slot.date,
    });
    if (!candidate) {
      const lockMsg = slotLock ? ` (locked to ${Array.from(slotLock.requiredTeams || []).join(', ')})` : '';
      let detailMsg = '';
      if (verbose && diagnostics.rejection) {
        const r = diagnostics.rejection;
        detailMsg = ` [${r.noGames} exhausted, ${r.wrongTeams} wrong-team, ${r.teamLocked} team-locked, ${r.sameDay} same-day, ${r.weekLimit || 0} week-limit, ${r.wouldExceed} would-exceed-max]`;
        if (diagnostics.forced && diagnostics.requiredTeams) {
          const locked = diagnostics.requiredTeams;
          const remaining = pairs.filter((p) => 
            p.remaining > 0 && locked.every((t) => p.teams.includes(t))
          );
          if (remaining.length === 0) {
            detailMsg += ` — ${locked.join(' & ')} have no games left against each other`;
          } else {
            const counts = remaining.map((p) => 
              `${p.teams.join(' vs ')} (${p.remaining} left)`
            ).join(', ');
            detailMsg += ` — pairs with games: ${counts}`;
          }
        }
      }
      return {
        success: false,
        reason: `No available matchup for slot #${i + 1} (${slot.date} ${slot.slot})${lockMsg}${detailMsg}`,
        slotIndex: i,
        partialGames: assignments,
      };
    }
    const game = assignGame({ slot, entry: candidate, rng, lock: slotLock, homeAwayCounts });
    assignments.push(game);
    candidate.remaining -= 1;
    const { away, home } = game;
    
    // Update home/away counts
    homeAwayCounts.home.set(home, homeAwayCounts.home.get(home) + 1);
    homeAwayCounts.away.set(away, homeAwayCounts.away.get(away) + 1);
    
    // Mark both teams as having played on this date
    teamsPlayedToday.add(away);
    teamsPlayedToday.add(home);
    
    // Track weekly games for both teams
    teamsThisWeek.set(away, (teamsThisWeek.get(away) || 0) + 1);
    teamsThisWeek.set(home, (teamsThisWeek.get(home) || 0) + 1);
    
    teamGamesRemaining.set(away, teamGamesRemaining.get(away) - 1);
    teamGamesRemaining.set(home, teamGamesRemaining.get(home) - 1);
    if (slot.slot === targetSlot) {
      teamTargetCounts.set(away, (teamTargetCounts.get(away) || 0) + 1);
      teamTargetCounts.set(home, (teamTargetCounts.get(home) || 0) + 1);
    }
  }

  const unfinished = pairs.filter((entry) => entry.remaining > 0);
  if (unfinished.length) {
    const examples = unfinished.slice(0, 3).map((p) => p.teams.join(' vs ')).join(', ');
    return {
      success: false,
      reason: `${unfinished.length} matchup(s) still unassigned (e.g., ${examples})`,
      slotIndex: null,
      partialGames: assignments,
    };
  }

  return {
    success: true,
    games: assignments,
    stats: {
      targetSlot,
      minTarget,
      maxTarget,
      targetCounts: Object.fromEntries(teamTargetCounts.entries()),
    },
    homeAwayCounts,
  };
};

const generateBalancedSchedule = ({
  teams,
  slots,
  targetSlot = DEFAULT_TARGET_SLOT,
  seed = Date.now(),
  gamesPerPair = DEFAULT_GAMES_PER_PAIR,
  maxAttempts = 20,
  lockRequirements = new Map(),
  verbose = false,
  optimizeHomeAway = true,
}) => {
  const normalizedTeams = toTeamArray(teams);
  if (!normalizedTeams.length) {
    throw new Error('No teams provided for generation.');
  }
  if (!slots || !slots.length) {
    throw new Error('No slots provided for generation.');
  }
  const failures = [];
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const attemptSeed = `${seed}-${attempt}`;
    const result = tryGenerateSchedule({
      teams: normalizedTeams,
      slots,
      targetSlot,
      seed: attemptSeed,
      gamesPerPair,
      lockRequirements,
      verbose,
    });
    if (result.success) {
      let finalGames = result.games;
      let flips = 0;
      
      // Verify no doubleheaders before optimization
      const dhCheck = verifyNoDoubleheaders(finalGames);
      if (!dhCheck.valid) {
        const violations = dhCheck.violations.slice(0, 3).map(v => 
          `${v.team} on ${v.date} (${v.gameCount} games)`
        ).join(', ');
        failures.push({
          attempt: attempt + 1,
          reason: `Generated schedule has doubleheaders: ${violations}`,
          slotIndex: null,
          partialGames: finalGames,
          seed: attemptSeed,
        });
        if (verbose) {
          console.error(`  Attempt ${attempt + 1} failed: Doubleheader violations found`);
        }
        continue; // Try next attempt
      }
      
      if (optimizeHomeAway) {
        const optimized = optimizeHomeAwayBalance(
          result.games,
          lockRequirements,
          `${attemptSeed}-optimize`,
          100
        );
        finalGames = optimized.games;
        flips = optimized.flips;
        
        // Verify no doubleheaders after optimization
        const dhCheckAfter = verifyNoDoubleheaders(finalGames);
        if (!dhCheckAfter.valid) {
          // Optimization introduced doubleheaders, use pre-optimized version
          if (verbose) {
            console.warn(`  Optimization introduced doubleheaders, using non-optimized schedule`);
          }
          finalGames = result.games;
          flips = 0;
        }
      }
      
      return { ...result, games: finalGames, seed: attemptSeed, attempts: attempt + 1, homeAwayFlips: flips };
    }
    failures.push({ 
      attempt: attempt + 1, 
      reason: result.reason, 
      slotIndex: result.slotIndex,
      partialGames: result.partialGames,
      seed: attemptSeed,
    });
    if (verbose) {
      console.error(`  Attempt ${attempt + 1} failed: ${result.reason}`);
    }
  }
  const reasonCounts = new Map();
  failures.forEach(({ reason }) => {
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  });
  const topReasons = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => `  - ${reason} (${count}x)`)
    .join('\n');
  const lastFailure = failures[failures.length - 1];
  const error = new Error(
    `Unable to build a balanced schedule after ${maxAttempts} attempts.\n` +
    `Last failure: ${lastFailure.reason}\n` +
    `Most common issues:\n${topReasons}`
  );
  error.failures = failures;
  throw error;
};

module.exports = {
  DEFAULT_TARGET_SLOT,
  DEFAULT_GAMES_PER_PAIR,
  createSeededRng,
  generateBalancedSchedule,
  summarizeSlotDistribution,
  computeSlotFairness,
  computeHomeAwayBalance,
  optimizeHomeAwayBalance,
  verifyNoDoubleheaders,
};
