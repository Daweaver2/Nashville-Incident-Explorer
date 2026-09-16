# Nashville Incident Explorer

Explore publicly available Metro Nashville Police Department incident data on an
interactive map. Select a year, search for an address or drop a pin, filter the
results by distance, and open an incident to view its details.

> This project is an exploratory data viewer. It is not an emergency service and
> the data should not be treated as a complete or real-time account of public
> safety activity.

## Features

- Browse mapped incidents by year.
- Search for a Nashville address using OpenStreetMap Nominatim geocoding.
- Drop a pin on the map and filter incidents within a radius of 0.1 to 100 miles.
- Open an incident marker to view its date, location, status, report information,
	offense, weapon, domestic-related flag, ZIP code, and source identifiers.
- Switch between dark and light display modes.
- Use the map with Leaflet and OpenStreetMap tiles.

## How It Works

The React/Vite client requests data from the Express API. During development,
Vite proxies `/api` requests to the API server on port `5000`. The API reads
incident records from MySQL and provides year, map marker, geocoding, and detail
endpoints.

## Tech Stack

- **Frontend:** React 19, Vite, React Leaflet, Leaflet
- **Backend:** Node.js, Express 5
- **Database:** MySQL
- **Data import:** Node.js streaming CSV parser

## Prerequisites

- Node.js 18 or newer. Node 20 or newer is recommended.
- npm
- MySQL 8 or a compatible MySQL server
- A Nashville incident CSV export with the columns expected by the importer

## Installation

Install dependencies for both applications:

```bash
git clone <repository-url>
cd Nashville-Incident-Explorer

cd server
npm install

cd ../client
npm install
```

The root `package.json` is a development launcher; dependencies are installed
separately because the client and server are independent packages.

## Configure MySQL

Create a database, then create the `incidents` table. The importer uses the
following fields and the API expects `incident_id` to be an auto-incrementing
primary key:

```sql
CREATE DATABASE nashville_incidents;
USE nashville_incidents;

CREATE TABLE incidents (
	incident_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
	object_id VARCHAR(64) NULL,
	primary_key VARCHAR(128) NULL,
	incident_number VARCHAR(64) NOT NULL,
	report_type_desc VARCHAR(255) NULL,
	incident_status VARCHAR(255) NULL,
	investigation_status VARCHAR(255) NULL,
	incident_location VARCHAR(255) NULL,
	latitude DECIMAL(10, 7) NULL,
	longitude DECIMAL(10, 7) NULL,
	zip_code VARCHAR(16) NULL,
	incident_occurred DATETIME NULL,
	incident_reported DATETIME NULL,
	offense_description VARCHAR(255) NULL,
	offense_nibrs VARCHAR(255) NULL,
	weapon_description VARCHAR(255) NULL,
	weapon_primary VARCHAR(255) NULL,
	domestic_related VARCHAR(32) NULL,
	location_description VARCHAR(255) NULL,
	victim_type VARCHAR(255) NULL,
	victim_description VARCHAR(255) NULL,
	PRIMARY KEY (incident_id),
	UNIQUE KEY incidents_object_id (object_id),
	UNIQUE KEY incidents_primary_key (primary_key),
	INDEX incidents_occurred (incident_occurred),
	INDEX incidents_coordinates (latitude, longitude)
);
```

If you already created the table using an older version of this project, run
this migration before importing the CSV again:

```sql
ALTER TABLE incidents
	ADD COLUMN incident_reported DATETIME NULL,
	ADD COLUMN offense_nibrs VARCHAR(255) NULL,
	ADD COLUMN weapon_primary VARCHAR(255) NULL,
	ADD COLUMN location_description VARCHAR(255) NULL,
	ADD COLUMN victim_type VARCHAR(255) NULL,
	ADD COLUMN victim_description VARCHAR(255) NULL;
```

Create `server/.env` with your local connection values. Do not commit this file
or share its password:

```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_NAME=nashville_incidents
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
PORT=5000
```

## Import Incident Data

Place the CSV in the repository root, or provide an absolute path. The importer
accepts the ArcGIS export fields used by the Metro Nashville incident dataset,
including `OBJECTID`, `Primary_Key`, `Incident_Number`, `Latitude`,
`Longitude`, and `Incident_Occurred`.

From the `server` directory, run:

```bash
cd server
npm run import:incidents -- --file=../Metro_Nashville_Police_Department_Incidents.csv
```

Rows are imported in transactions of 1,000 by default. Invalid rows are skipped
and reported at the end. The importer uses `object_id` and `primary_key` as
duplicate keys, so re-running it updates existing records instead of creating a
second copy. To change the batch size or file:

```bash
npm run import:incidents -- --file=/path/to/incidents.csv --batch-size=2000
```

## Run Locally

From the repository root, start the API and frontend together:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Press `Ctrl+C` to stop both
processes.

You can also run them separately:

```bash
# Terminal 1
cd server
npm start

# Terminal 2
cd client
npm run dev
```

The API listens on [http://localhost:5000](http://localhost:5000) by default.
Change `PORT` in `server/.env` and the proxy target in `client/vite.config.js`
together if you use a different API port.

## Useful Commands

| Command | Directory | Purpose |
| --- | --- | --- |
| `npm run dev` | repository root | Start the API and Vite client |
| `npm start` | `server` | Start only the API |
| `npm run import:incidents -- --file=...` | `server` | Import a CSV export |
| `npm run lint` | `client` | Run ESLint |
| `npm run build` | `client` | Create a production client build |
| `npm run preview` | `client` | Preview the production client build |

## API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/incidents/years` | List years available in the database |
| `GET` | `/api/incidents/search?incidentNumber=...` | Find incidents by a full or partial incident number |
| `GET` | `/api/incidents?year=2024` | Return mapped incidents for a year |
| `GET` | `/api/incidents?year=2024&latitude=36.16&longitude=-86.78&radius=1` | Filter incidents within a radius in miles |
| `GET` | `/api/incidents/:incidentId` | Return full details for one incident |
| `GET` | `/api/incidents/:incidentId/comments` | List comments for an incident |
| `POST` | `/api/incidents/:incidentId/comments` | Add a comment (requires authentication) |
| `GET` | `/api/geocode?address=...` | Geocode a Nashville address |

Account endpoints are available at `/api/auth/register`, `/api/auth/login`,
`/api/auth/me`, and `PATCH /api/auth/me`. The account menu lets users choose
whether their comments display their username or `Anonymous`. Passwords are
stored as scrypt hashes, and authenticated requests use a short-lived signed
token.

The existing `users` table must include the privacy setting used by the account
menu:

```sql
ALTER TABLE users
	ADD COLUMN is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;
```

## Troubleshooting

**The map says “Connect the server to load incidents.”**

Make sure MySQL is running, `server/.env` has valid credentials, the `incidents`
table exists, and the API is running on port `5000`.

**No incidents appear after the app starts.**

The application needs imported rows with valid coordinates and dates. Run the
CSV importer, then refresh the client.

**Address search fails.**

Geocoding uses the public OpenStreetMap Nominatim service and requires network
access. Try a more complete Nashville address and respect the service's usage
limits.

**The importer skips rows.**

Rows without an incident number or valid latitude and longitude are skipped. The
importer prints example row errors when it finishes.

## Data Source and Attribution

Incident records are intended to come from the Metro Nashville Police
Department's public open-data export. Map tiles and address lookup are provided
by OpenStreetMap contributors through Leaflet and Nominatim. Review the source
dataset's terms and freshness before using the data for analysis or decisions.

## Project Structure

```text
.
├── client/       React/Vite application
├── server/       Express API and CSV importer
├── dev.js        Starts the client and server together
└── README.md
```

## License

See [LICENSE](LICENSE) for the project license.