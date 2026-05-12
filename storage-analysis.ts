/**
 * Storage Requirements Analysis for NDJSON Traffic Data
 * ======================================================
 * 
 * Assumptions:
 * - 3 NDJSON lines per request (base, hint, final)
 * - Each line includes newline character (\n)
 * - Average event sizes calculated from mock data
 */

// ============================================================
// Sample NDJSON Event Sizes (in bytes)
// ============================================================

const SAMPLE_EVENTS = {
  base: `{"id":"019c0def-caf8-7817-9341-f98f0b942971","ts":1769760344824,"destination":"bol.com","flow":"my-flow","flow_execution_id":"98-1761116764768886932","trigger_ua":"Postman/1.0","trigger_ip":"10.0.127.215"}`,
  hint: `{"id":"019c0def-caf8-7817-9341-f98f0b942971","payload_size":5432,"ttfb-hint":156}`,
  final: `{"id":"019c0def-caf8-7817-9341-f98f0b942971","ttfb":234,"response_size":8765,"response_code":200}`,
};

// Calculate actual sizes
const baseSizeBytes = Buffer.from(SAMPLE_EVENTS.base + '\n').length;
const hintSizeBytes = Buffer.from(SAMPLE_EVENTS.hint + '\n').length;
const finalSizeBytes = Buffer.from(SAMPLE_EVENTS.final + '\n').length;
const totalPerRequestBytes = baseSizeBytes + hintSizeBytes + finalSizeBytes;

console.log('='.repeat(70));
console.log('NDJSON EVENT SIZES');
console.log('='.repeat(70));
console.log(`Base event:   ${baseSizeBytes} bytes`);
console.log(`Hint event:   ${hintSizeBytes} bytes`);
console.log(`Final event:  ${finalSizeBytes} bytes`);
console.log(`Total/request: ${totalPerRequestBytes} bytes`);
console.log();

// ============================================================
// Time Constants
// ============================================================

const SECONDS_PER_DAY = 24 * 60 * 60;
const SECONDS_PER_MONTH = 30 * SECONDS_PER_DAY;
const EVENTS_PER_REQUEST = 3;

// ============================================================
// Calculation Function
// ============================================================

interface StorageCalculation {
  eventsPerSecond: number;
  eventsPerDay: number;
  requestsPerDay: number;
  bytesPerDay: number;
  mbPerDay: number;
  gbPerMonth: number;
}

function calculateStorage(eventsPerSecond: number): StorageCalculation {
  // Events per day
  const eventsPerDay = eventsPerSecond * SECONDS_PER_DAY;
  
  // Requests per day (divide by 3 since each request = 3 events)
  const requestsPerDay = eventsPerDay / EVENTS_PER_REQUEST;
  
  // Total bytes per day
  const bytesPerDay = requestsPerDay * totalPerRequestBytes;
  
  // Megabytes per day
  const mbPerDay = bytesPerDay / (1024 * 1024);
  
  // Gigabytes per month (30 days)
  const gbPerMonth = (mbPerDay * 30) / 1024;
  
  return {
    eventsPerSecond,
    eventsPerDay,
    requestsPerDay,
    bytesPerDay,
    mbPerDay,
    gbPerMonth,
  };
}

// ============================================================
// Calculate for different event rates
// ============================================================

const eventRates = [2, 5, 10, 20, 30, 50, 100, 200, 500];
const calculations = eventRates.map((rate) => calculateStorage(rate));

// ============================================================
// Display Results Table
// ============================================================

console.log('='.repeat(110));
console.log('STORAGE REQUIREMENTS FOR DIFFERENT EVENT RATES');
console.log('='.repeat(110));
console.log(
  'Events/sec'.padEnd(15) +
  'Events/day'.padEnd(20) +
  'Requests/day'.padEnd(20) +
  'MB/day'.padEnd(20) +
  'GB/month (30d)'.padEnd(20)
);
console.log('-'.repeat(110));

calculations.forEach((calc) => {
  const eventsPerSecStr = calc.eventsPerSecond.toLocaleString().padEnd(15);
  const eventsPerDayStr = Math.round(calc.eventsPerDay).toLocaleString().padEnd(20);
  const requestsPerDayStr = Math.round(calc.requestsPerDay).toLocaleString().padEnd(20);
  const mbPerDayStr = calc.mbPerDay.toFixed(2).padEnd(20);
  const gbPerMonthStr = calc.gbPerMonth.toFixed(2).padEnd(20);
  
  console.log(eventsPerSecStr + eventsPerDayStr + requestsPerDayStr + mbPerDayStr + gbPerMonthStr);
});

console.log('='.repeat(110));
console.log();

// ============================================================
// Detailed Breakdown for Key Scenarios
// ============================================================

console.log('='.repeat(110));
console.log('DETAILED STORAGE BREAKDOWN');
console.log('='.repeat(110));
console.log();

calculations.forEach((calc) => {
  console.log(`📊 ${calc.eventsPerSecond} events/second:`);
  console.log(`   • ${Math.round(calc.eventsPerDay).toLocaleString()} events per day`);
  console.log(`   • ${Math.round(calc.requestsPerDay).toLocaleString()} requests per day`);
  console.log(`   • ${(calc.bytesPerDay / (1024 * 1024 * 1024)).toFixed(4)} GB per day`);
  console.log(`   • ${calc.mbPerDay.toFixed(2)} MB per day`);
  console.log(`   • ${(calc.mbPerDay * 7).toFixed(2)} MB per week`);
  console.log(`   • ${(calc.mbPerDay * 30).toFixed(2)} MB per 30-day month`);
  console.log(`   • ${calc.gbPerMonth.toFixed(2)} GB per month`);
  console.log();
});

// ============================================================
// Real-world Scenarios & Recommendations
// ============================================================

console.log('='.repeat(110));
console.log('REAL-WORLD SCENARIOS & STORAGE OPTIONS');
console.log('='.repeat(110));
console.log();

const scenarios = [
  { name: 'Light traffic', rate: 2, description: 'Small deployment, internal only' },
  { name: 'Normal traffic', rate: 10, description: 'Medium deployment, typical usage' },
  { name: 'Busy traffic', rate: 50, description: 'High-volume deployment' },
  { name: 'Extremely busy', rate: 200, description: 'Enterprise deployment, multiple data centers' },
];

scenarios.forEach(({ name, rate, description }) => {
  const calc = calculateStorage(rate);
  console.log(`📌 ${name.toUpperCase()} (${rate} events/sec)`);
  console.log(`   Description: ${description}`);
  console.log(`   Storage for 30-day retention: ${calc.gbPerMonth.toFixed(2)} GB`);
  console.log();
  
  // Storage recommendations
  if (calc.gbPerMonth < 10) {
    console.log(`   💾 Storage Options:`);
    console.log(`      • Local SSD: Sufficient (very cost-effective)`);
    console.log(`      • PostgreSQL: jsonb + compression = ~${(calc.gbPerMonth * 0.6).toFixed(2)} GB`);
  } else if (calc.gbPerMonth < 100) {
    console.log(`   💾 Storage Options:`);
    console.log(`      • PostgreSQL with compression: ~${(calc.gbPerMonth * 0.6).toFixed(2)} GB`);
    console.log(`      • TimescaleDB (optimized for time-series): ~${(calc.gbPerMonth * 0.5).toFixed(2)} GB`);
    console.log(`      • Local NAS: Sufficient (RAID-5/6 recommended)`);
  } else if (calc.gbPerMonth < 1000) {
    console.log(`   💾 Storage Options:`);
    console.log(`      • TimescaleDB with compression: ~${(calc.gbPerMonth * 0.5).toFixed(2)} GB`);
    console.log(`      • ClickHouse (OLAP DB, excellent compression): ~${(calc.gbPerMonth * 0.3).toFixed(2)} GB`);
    console.log(`      • AWS S3 (lifecycle policies for archive): Cost-effective for long-term`);
    console.log(`      • Object Storage (MinIO, etc.): ~$${(calc.gbPerMonth * 0.023).toFixed(2)}/month at 0.023$/GB`);
  } else {
    console.log(`   💾 Storage Options:`);
    console.log(`      • ClickHouse distributed: ~${(calc.gbPerMonth * 0.3).toFixed(2)} GB ingested`);
    console.log(`      • S3 + Glacier for archive: Cost-effective`);
    console.log(`      • Recommended: Cloud data warehouse (BigQuery, Redshift, Snowflake)`);
  }
  console.log();
});

// ============================================================
// Database Sizing Comparisons
// ============================================================

console.log('='.repeat(110));
console.log('DATABASE TYPE COMPARISONS (30-day storage, at 10 events/second)');
console.log('='.repeat(110));
console.log();

const calc10 = calculateStorage(10);
const databases = [
  { name: 'PostgreSQL + jsonb', compression: 0.65, notes: 'Native JSON, good with compression' },
  { name: 'TimescaleDB', compression: 0.55, notes: 'Built for time-series, auto-compression' },
  { name: 'ClickHouse', compression: 0.30, notes: 'OLAP optimized, excellent compression' },
  { name: 'MongoDB', compression: 0.70, notes: 'Document DB, good for event streams' },
  { name: 'S3 + Parquet', compression: 0.25, notes: 'Object storage + columnar format' },
];

console.log('Database Type'.padEnd(25) + 'Space (GB)'.padEnd(15) + 'Monthly Cost Est.'.padEnd(20) + 'Notes');
console.log('-'.repeat(110));

databases.forEach(({ name, compression, notes }) => {
  const sizeGb = (calc10.gbPerMonth * compression).toFixed(2);
  const costEst = (calc10.gbPerMonth * compression * 0.025).toFixed(2);
  console.log(
    name.padEnd(25) +
    sizeGb.padEnd(15) +
    `$${costEst}`.padEnd(20) +
    notes
  );
});

console.log();
console.log('='.repeat(110));
