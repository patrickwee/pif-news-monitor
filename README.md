# PIF News Monitor

A self-contained browser dashboard for ongoing news monitoring of PIF mentions.

## Run

```bash
npm start
```

Then open:

```text
http://localhost:4173
```

## Data Source

The dashboard queries the public GDELT 2.1 Docs API through the included local server. If GDELT throttles or fails, the server falls back to Google News RSS for the same query window. The default search is:

```text
("Public Investment Fund" OR "Saudi PIF" OR ("PIF" AND Saudi))
```

You can edit the search scope, window, and refresh cadence directly in the dashboard. Settings are saved in local browser storage.

## Deploy

This project is ready to deploy on Vercel:

```bash
vercel
```

The web deployment uses `api/news.js` as the serverless news proxy and serves `index.html`, `styles.css`, and `app.js` as static assets.
