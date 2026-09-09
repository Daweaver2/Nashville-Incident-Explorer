# Nashville Incident Explorer

## Run the App

From the repository root, start both the API and frontend with:

```bash
npm run dev
```

The frontend will be available at the Vite URL, usually `http://localhost:5173`.
Press `Ctrl+C` once to stop both processes.

A full-stack web application for exploring and querying Nashville (MNPD) open incident data.

## Tech Stack
* **Frontend:** React (Vite)
* **Backend:** Node.js, Express
* **Database:** MySQL

## Import Historical Incidents

The server includes a streaming importer for the large ArcGIS CSV export. Set the
database values in `server/.env`, ensure the `incidents` table exists, then run:

```bash
cd server
npm run import:incidents -- --file=../Metro_Nashville_Police_Department_Incidents.csv
```

The importer processes 1,000 rows per transaction by default and can be rerun
safely because `object_id` and `primary_key` are unique. To use a different file
or batch size:

```bash
npm run import:incidents -- --file=/path/to/incidents.csv --batch-size=2000
```

## Database Structure
* **Table-1: Incidents**
```-Store all the historical MNPD open data```
* **Table-2: Users**
```-Manage user accounts for community features```
* **Table-3: Comments**
```-Ties specific users to specific incidents for chat logs```