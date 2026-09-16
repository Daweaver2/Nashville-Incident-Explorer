require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { parse } = require('csv-parse');

const DEFAULT_FILE = path.resolve(__dirname, '..', 'Metro_Nashville_Police_Department_Incidents.csv');
const BATCH_SIZE = 1000;

const columns = [
  'object_id',
  'primary_key',
  'incident_number',
  'report_type_desc',
  'incident_status',
  'investigation_status',
  'incident_location',
  'latitude',
  'longitude',
  'zip_code',
  'incident_occurred',
  'incident_reported',
  'offense_description',
  'offense_nibrs',
  'weapon_description',
  'weapon_primary',
  'domestic_related',
  'location_description',
  'victim_type',
  'victim_description',
];

const insertSql = `
  INSERT INTO incidents (${columns.join(', ')})
  VALUES (${columns.map(() => '?').join(', ')})
  ON DUPLICATE KEY UPDATE
    object_id = VALUES(object_id),
    primary_key = VALUES(primary_key),
    incident_number = VALUES(incident_number),
    report_type_desc = VALUES(report_type_desc),
    incident_status = VALUES(incident_status),
    investigation_status = VALUES(investigation_status),
    incident_location = VALUES(incident_location),
    latitude = VALUES(latitude),
    longitude = VALUES(longitude),
    zip_code = VALUES(zip_code),
    incident_occurred = VALUES(incident_occurred),
    incident_reported = VALUES(incident_reported),
    offense_description = VALUES(offense_description),
    offense_nibrs = VALUES(offense_nibrs),
    weapon_description = VALUES(weapon_description),
    weapon_primary = VALUES(weapon_primary),
    domestic_related = VALUES(domestic_related),
    location_description = VALUES(location_description),
    victim_type = VALUES(victim_type),
    victim_description = VALUES(victim_description)
`;

function getOption(name, fallback) {
  const prefix = `${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function nullable(value) {
  const normalized = String(value ?? '').trim();
  return normalized === '' ? null : normalized;
}

function mysqlDate(value) {
  const normalized = nullable(value);
  if (!normalized) return null;

  const match = normalized.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour}:${minute}:${second}`;
}

function mapRow(row) {
  const latitude = Number(nullable(row.Latitude));
  const longitude = Number(nullable(row.Longitude));
  const incidentNumber = nullable(row.Incident_Number);

  if (!incidentNumber) throw new Error('missing Incident_Number');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('invalid Latitude or Longitude');
  }

  return [
    nullable(row.OBJECTID),
    nullable(row.Primary_Key),
    incidentNumber,
    nullable(row.Report_Type_Description),
    nullable(row.Incident_Status_Description),
    nullable(row.Investigation_Status),
    nullable(row.Incident_Location),
    latitude,
    longitude,
    nullable(row.ZIP_Code),
    mysqlDate(row.Incident_Occurred),
    mysqlDate(row.Incident_Reported),
    nullable(row.Offense_Description),
    nullable(row.Offense_NIBRS),
    nullable(row.Weapon_Description),
    nullable(row.Weapon_Primary),
    nullable(row.Domestic_Related),
    nullable(row.Location_Description),
    nullable(row.Victim_Type),
    nullable(row.Victim_Description),
  ];
}

async function insertBatch(connection, rows) {
  if (rows.length === 0) return;

  const placeholders = rows.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
  const values = rows.flat();
  const sql = insertSql.replace(`VALUES (${columns.map(() => '?').join(', ')})`, `VALUES ${placeholders}`);
  await connection.query(sql, values);
}

async function ensureImportSchema(connection) {
  const columnsToAdd = [
    ['incident_reported', 'DATETIME NULL'],
    ['offense_nibrs', 'VARCHAR(255) NULL'],
    ['weapon_primary', 'VARCHAR(255) NULL'],
    ['location_description', 'VARCHAR(255) NULL'],
    ['victim_type', 'VARCHAR(255) NULL'],
    ['victim_description', 'VARCHAR(255) NULL'],
  ];
  for (const [column, definition] of columnsToAdd) {
    const [rows] = await connection.execute(`
      SELECT COUNT(*) AS column_count
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'incidents' AND column_name = ?
    `, [column]);
    if (rows[0].column_count === 0) await connection.query(`ALTER TABLE incidents ADD COLUMN ${column} ${definition}`);
  }
}

async function main() {
  const file = path.resolve(process.cwd(), getOption('--file', DEFAULT_FILE));
  const batchSize = Number.parseInt(getOption('--batch-size', BATCH_SIZE), 10);

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('--batch-size must be a positive integer');
  }
  if (!fs.existsSync(file)) throw new Error(`CSV file not found: ${file}`);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await ensureImportSchema(connection);

  let read = 0;
  let imported = 0;
  let skipped = 0;
  let batch = [];
  const skippedExamples = [];

  try {
    const parser = fs.createReadStream(file).pipe(parse({
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }));

    for await (const row of parser) {
      read += 1;
      try {
        batch.push(mapRow(row));
      } catch (error) {
        skipped += 1;
        if (skippedExamples.length < 10) {
          skippedExamples.push(`row ${read}: ${error.message}`);
        }
      }

      if (batch.length >= batchSize) {
        await connection.beginTransaction();
        try {
          await insertBatch(connection, batch);
          await connection.commit();
          imported += batch.length;
          batch = [];
        } catch (error) {
          await connection.rollback();
          throw error;
        }
        process.stdout.write(`Imported ${imported} rows (read ${read}, skipped ${skipped})\r`);
      }
    }

    if (batch.length > 0) {
      await connection.beginTransaction();
      try {
        await insertBatch(connection, batch);
        await connection.commit();
        imported += batch.length;
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
  } finally {
    await connection.end();
  }

  console.log(`\nFinished: imported ${imported} rows, read ${read}, skipped ${skipped}.`);
  if (skippedExamples.length > 0) {
    console.warn(`Examples of skipped rows:\n${skippedExamples.join('\n')}`);
  }
}

main().catch((error) => {
  console.error(`Import failed: ${error.message}`);
  process.exitCode = 1;
});