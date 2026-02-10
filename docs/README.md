# Schedule Analysis Web Viewer

This directory contains a static web application for viewing and comparing schedule analyses.

## Setup for GitHub Pages

1. **Generate analysis files:**
   ```bash
   npm run export
   ```
   This creates JSON analysis files in `docs/analysis/` for all schedules in the `generated/` directory.

2. **Enable GitHub Pages:**
   - Go to your repository settings on GitHub
   - Navigate to "Pages" in the left sidebar
   - Under "Source", select "Deploy from a branch"
   - Select the `main` branch and `/docs` folder
   - Click "Save"

3. **Access your page:**
   After a few minutes, your page will be available at:
   `https://[your-username].github.io/[repository-name]/`

## Usage

### Exporting Schedules

Export all schedules in the generated directory:
```bash
npm run export
```

Export a specific schedule file:
```bash
npm run export -- --input ORIGINAL-schedule.txt
```

Export from a different directory:
```bash
npm run export -- --dir my-schedules
```

Change output directory:
```bash
npm run export -- --output-dir docs/analysis
```

### Viewing the Analysis

Open `docs/index.html` in a web browser locally, or visit your GitHub Pages URL after deployment.

The viewer allows you to:
- Select multiple schedules to compare side-by-side
- View home/away balance statistics
- Check time slot verification
- Verify locked teams are in correct slots
- Analyze target slot distribution
- Review opponent balance

## Files Structure

```
docs/
├── index.html          # Main web application
├── .nojekyll          # Tells GitHub Pages not to process with Jekyll
├── analysis/          # Generated analysis JSON files
│   ├── index.json    # Index of all schedules
│   ├── schedule.json
│   ├── schedule-2.json
│   └── ...
└── README.md          # This file
```

## Updating the Analysis

Whenever you generate new schedules or want to update the analysis:

1. Run `npm run export` to regenerate the JSON files
2. Commit and push the changes to GitHub
3. GitHub Pages will automatically update (may take a few minutes)

## Local Development

To preview locally without deploying:

1. Generate the analysis files: `npm run export`
2. Open `docs/index.html` directly in a browser, or use a local server:
   ```bash
   npx http-server docs
   ```
3. Navigate to the provided URL (usually http://localhost:8080)
