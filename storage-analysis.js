/**
 * Storage Requirements Analysis for NDJSON Traffic Data
 * ======================================================
 */

// Sample NDJSON Event Sizes (in bytes)
const SAMPLE_EVENTS = {
  base: `{"id":"019c0def-caf8-7817-9341-f98f0b942971","ts":1769760344824,"destination":"bol.com","flow":"my-flow","flow_execution_id":"98-1761116764768886932","trigger_ua":"Postman/1.0","trigger_ip":"10.0.127.215"}`,
  hint: `{"id":"019c0def-caf8-7817-9341-f98f0b942971","payload_size":5432,"ttfb-hint":156}`,
  final: `{"id":"019c0def-caf8-7817-9341-f98f0b942971","ttfb":234,"response_size":8765,"response_code":200}`,
};

// Calculate actual sizes (add newline)
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

// Time Constants
const SECONDS_PER_DAY = 24 * 60 * 60;
const EVENTS_PER_REQUEST = 3;

function calculateStorage(eventsPerSecond) {
  const eventsPerDay = eventsPerSecond * SECONDS_PER_DAY;
  const requestsPerDay = eventsPerDay / EVENTS_PER_REQUEST;
  const bytesPerDay = requestsPerDay * totalPerRequestBytes;
  const mbPerDay = bytesPerDay / (1024 * 1024);
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

// Calculate for different event rates
const eventRates = [2, 5, 10, 20, 30, 50, 100, 200, 500];
const calculations = eventRates.map((rate) => calculateStorage(rate));

// Display Results Table
console.log('='.repeat(120));
console.log('STORAGE REQUIREMENTS FOR DIFFERENT EVENT RATES');
console.log('='.repeat(120));
console.log(
  'Events/sec'.padEnd(15) +
  'Events/day'.padEnd(22) +
  'Req/day'.padEnd(18) +
  'MB/day'.padEnd(15) +
  'MB/month'.padEnd(15) +
  'GB/month'.padEnd(15)
);
console.log('-'.repeat(120));

calculations.forEach((calc) => {
  const eventsPerSecStr = calc.eventsPerSecond.toLocaleString().padEnd(15);
  const eventsPerDayStr = calc.eventsPerDay.toLocaleString('en-US', {maximumFractionDigits: 0}).padEnd(22);
  const requestsPerDayStr = calc.requestsPerDay.toLocaleString('en-US', {maximumFractionDigits: 0}).padEnd(18);
  const mbPerDayStr = calc.mbPerDay.toFixed(2).padEnd(15);
  const mbPerMonthStr = (calc.mbPerDay * 30).toFixed(2).padEnd(15);
  const gbPerMonthStr = calc.gbPerMonth.toFixed(3).padEnd(15);
  
  console.log(eventsPerSecStr + eventsPerDayStr + requestsPerDayStr + mbPerDayStr + mbPerMonthStr + gbPerMonthStr);
});

console.log('='.repeat(120));
console.log();

// Detailed Breakdown
console.log('='.repeat(120));
console.log('DETAILED STORAGE BREAKDOWN');
console.log('='.repeat(120));
console.log();

calculations.forEach((calc) => {
  console.log(`📊 ${calc.eventsPerSecond} events/second:`);
  console.log(`   • Events/day:        ${calc.eventsPerDay.toLocaleString('en-US', {maximumFractionDigits: 0})}`);
  console.log(`   • Requests/day:      ${calc.requestsPerDay.toLocaleString('en-US', {maximumFractionDigits: 0})}`);
  console.log(`   • GB per day:        ${(calc.bytesPerDay / (1024 * 1024 * 1024)).toFixed(4)}`);
  console.log(`   • MB per day:        ${calc.mbPerDay.toFixed(2)}`);
  console.log(`   • MB per week (7d):  ${(calc.mbPerDay * 7).toFixed(2)}`);
  console.log(`   • MB per month (30d): ${(calc.mbPerDay * 30).toFixed(2)}`);
  console.log(`   • GB per month (30d): ${calc.gbPerMonth.toFixed(3)}`);
  console.log();
});

// Real-world Scenarios
console.log('='.repeat(120));
console.log('REAL-WORLD SCENARIOS');
console.log('='.repeat(120));
console.log();

const scenarios = [
  { name: 'Light (2/sec)', rate: 2, desc: 'Small deployment' },
  { name: 'Low (5/sec)', rate: 5, desc: 'Small business' },
  { name: 'Normal (10/sec)', rate: 10, desc: 'Medium deployment' },
  { name: 'Moderate (20/sec)', rate: 20, desc: 'Growing business' },
  { name: 'Busy (50/sec)', rate: 50, desc: 'High volume' },
  { name: 'Very Busy (100/sec)', rate: 100, desc: 'Enterprise' },
  { name: 'Extreme (200/sec)', rate: 200, desc: 'Very large enterprise' },
  { name: 'Max (500/sec)', rate: 500, desc: 'Multi-datacenter' },
];

scenarios.forEach(({ name, rate, desc }) => {
  const calc = calculateStorage(rate);
  console.log(`${name.padEnd(25)} (${desc})`);
  console.log(`   30-day storage: ${calc.gbPerMonth.toFixed(2)} GB (${(calc.mbPerDay * 30).toFixed(0)} MB)`);
  console.log();
});

// Database Comparisons
console.log('='.repeat(120));
console.log('DATABASE TYPE COMPARISONS (at 10 events/second, 30-day retention)');
console.log('='.repeat(120));
console.log();

const calc10 = calculateStorage(10);
const databases = [
  { name: 'PostgreSQL jsonb', ratio: 0.65, cost: '$0.03/GB/month' },
  { name: 'TimescaleDB', ratio: 0.55, cost: '$0.025/GB/month' },
  { name: 'ClickHouse', ratio: 0.30, cost: '$0.02/GB/month' },
  { name: 'MongoDB', ratio: 0.70, cost: '$0.05/GB/month' },
  { name: 'S3 + Parquet', ratio: 0.25, cost: '$0.023/GB/month' },
];

console.log('Database Type'.padEnd(22) + 'Space (GB)'.padEnd(15) + 'Cost/month'.padEnd(15) + 'Monthly Bill');
console.log('-'.repeat(120));

databases.forEach(({ name, ratio, cost }) => {
  const sizeGb = (calc10.gbPerMonth * ratio).toFixed(2);
  const costPerGb = parseFloat(cost.match(/[\d.]+/)[0]);
  const monthlyBill = ((calc10.gbPerMonth * ratio) * costPerGb).toFixed(2);
  
  console.log(
    name.padEnd(22) +
    sizeGb.padEnd(15) +
    cost.padEnd(15) +
    `$${monthlyBill}`
  );
});

console.log();
console.log('='.repeat(120));
