# Schedule Generator & Analyzer

A comprehensive toolkit for generating and analyzing balanced sports schedules with considerations for time slot distribution, home/away balance, and team constraints.

## Features

- **Schedule Generation**: Create balanced schedules from time slot templates
- **Home/Away Balance**: Automatically optimize home/away assignments for fairness
- **Team Locking**: Lock specific teams to their original time slots
- **Time Slot Distribution**: Balance games across preferred time slots
- **Opponent Balance**: Ensure each team plays opponents the correct number of times
- **Analysis & Verification**: Comprehensive analysis of schedule quality
- **Web Viewer**: Interactive comparison tool for analyzing multiple schedules (GitHub Pages)

## Quick Start

### Analyze an Existing Schedule

```bash
npm run analyze
# or analyze a specific file
npm run analyze -- --input ORIGINAL-schedule.txt
```

### Generate New Schedules

```bash
npm run generate
# Generate multiple schedules
npm run generate -- --count 5
```

### Export for Web Viewing

```bash
npm run export
```

Then open `docs/index.html` in a browser or deploy to GitHub Pages.

## Commands

### `npm run analyze`

Analyzes schedule files and reports:
- Time slot distribution for target slot (default: 7:00PM - 9:00PM)
- Home/away balance per team
- Team statistics and game counts
- Opponent verification (each pair plays correct number of games)
- Time slot adherence verification
- Locked team verification

**Options:**
- `--input <file>` - Analyze specific file
- `--dir <directory>` - Analyze all .txt files in directory
- `--target-slot <slot>` - Target slot to analyze
- `--time-slots <file>` - Time slots file for verification
- `--lock-file <file>` - Locked teams file for verification

### `npm run generate`

Generates new balanced schedules with optimization for:
- Target time slot distribution
- Home/away balance across all teams
- Locked team constraints
- No team plays twice on same day

**Options:**
- `--input <file>` - Input schedule to derive teams from (default: ORIGINAL-schedule.txt)
- `--output <file>` - Explicit output file path
- `--output-dir <dir>` - Output directory (default: generated/)
- `--output-name <file>` - Base output filename
- `--count <n>` - Number of schedules to generate
- `--seed <value>` - Seed for deterministic generation
- `--games-per-pair <n>` - Games each team pair must play (default: 3)
- `--max-attempts <n>` - Maximum retry attempts (default: 20)
- `--time-slots <file>` - Canonical time slots file (default: time-slots.txt)
- `--lock-file <file>` - Teams to lock to slots (default: lock-teams.txt)
- `--verbose, -v` - Show detailed failure reasons

### `npm run export`

Exports schedule analysis to JSON files for web viewing:
- Creates analysis JSON for each schedule
- Generates index file for web viewer
- Default output: `docs/analysis/`

**Options:**
- `--input <file>` - Export specific file
- `--dir <directory>` - Export all .txt files in directory
- `--output-dir <dir>` - Output directory for JSON files

## Files Structure

```
├── ORIGINAL-schedule.txt # Original/baseline schedule file (tab-separated)
├── time-slots.txt       # Canonical time slot list (date|slot format)
├── lock-teams.txt       # Teams to lock to their time slots
├── pony-schedule.txt    # Legacy format schedule (fallback)
├── generated/           # Generated schedule outputs
├── docs/                # Web viewer (GitHub Pages)
│   ├── index.html      # Interactive schedule comparison
│   └── analysis/       # JSON analysis files
└── src/                 # Source code
    ├── cli.js          # Main CLI interface
    ├── scheduleGenerator.js  # Generation logic
    ├── parseSchedule.js      # Schedule parsing
    └── schedule-analysis.js  # Standalone analysis script
```

## Schedule File Formats

### Main Format (ORIGINAL-schedule.txt)

Tab-separated values:
```
date    away    home    slot
03/01/2026	Yankees	Red Sox	7:00PM - 9:00PM
03/01/2026	Cubs	Dodgers	5:00PM - 7:00PM
```

### Time Slots File (time-slots.txt)

Pipe-separated date and time slot:
```
03/01/2026|7:00PM - 9:00PM
03/01/2026|5:00PM - 7:00PM
03/08/2026|7:00PM - 9:00PM
```

### Lock Teams File (lock-teams.txt)

One team name per line (teams that should stay in their original slots):
```
Yankees
Red Sox
Cubs
```

## Web Viewer (GitHub Pages)

The project includes an interactive web-based schedule comparison tool.

### Setup

1. Generate analysis files:
   ```bash
   npm run export
   ```

2. Enable GitHub Pages:
   - Repository Settings → Pages
   - Source: Deploy from branch `main`
   - Folder: `/docs`

3. Access at: `https://[username].github.io/[repo-name]/`

See [docs/README.md](docs/README.md) for detailed instructions.

## Home/Away Balance

The generator optimizes home/away assignments to ensure fairness:

1. **During Generation**: Considers each team's current home/away count when assigning games
2. **Post-Generation Optimization**: Flips games to reduce imbalance while respecting locked teams
3. **Analysis**: Reports balance statistics (perfect/nearly balanced/imbalanced)

Balance targets:
- **Perfect**: Home games = Away games (diff: 0)
- **Nearly Balanced**: ±1 game difference
- **Imbalanced**: >1 game difference

## Examples

### Generate 3 schedules with specific seed
```bash
npm run generate -- --count 3 --seed "spring-2026"
```

### Analyze generated schedules
```bash
npm run analyze -- --dir generated
```

### Generate and export for web viewing
```bash
npm run generate -- --count 5
npm run export
```

### Generate with custom time slots and locks
```bash
npm run generate -- --time-slots my-slots.txt --lock-file my-locks.txt
```

## How It Works

### Generation Algorithm

1. **Initialization**: Load teams from input schedule and time slots
2. **Pair Creation**: Generate all team pairs with games-per-pair count
3. **Slot Assignment**: For each time slot:
   - Select best pair based on target slot needs, availability, and date constraints
   - Assign home/away considering current balance
   - Respect locked team requirements
   - Ensure no team plays twice on same day
4. **Optimization**: Apply home/away flips to improve balance
5. **Verification**: Check all constraints are met

### Analysis Metrics

- **Target Slot Distribution**: How many games each team has in the preferred slot
- **Home/Away Balance**: Difference between home and away games per team
- **Opponent Balance**: Verification that each pair plays exactly N games
- **Time Slot Adherence**: Games match the canonical time slot list
- **Lock Verification**: Locked teams appear in their designated slots

## License

ISC
