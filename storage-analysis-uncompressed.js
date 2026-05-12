/**
 * Storage Requirements Analysis - UNCOMPRESSED
 * =============================================
 * Tenant-based system with customer-provided databases
 * Showing raw NDJSON sizes without any compression
 */

// Sample NDJSON Event Sizes (in bytes) - UNCOMPRESSED
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
console.log('NDJSON EVENT SIZES (UNCOMPRESSED)');
console.log('='.repeat(70));
console.log(`Base event:   ${baseSizeBytes} bytes`);
console.log(`Hint event:   ${hintSizeBytes} bytes`);
console.log(`Final event:  ${finalSizeBytes} bytes`);
console.log(`Total/request: ${totalPerRequestBytes} bytes`);
console.log();

// Time Constants
const SECONDS_PER_DAY = 24 * 60 * 60;
const SECONDS_PER_HOUR = 60 * 60;
const SECONDS_PER_MINUTE = 60;
const EVENTS_PER_REQUEST = 3;

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function calculateStorage(eventsPerSecond) {
  const eventsPerMinute = eventsPerSecond * SECONDS_PER_MINUTE;
  const eventsPerHour = eventsPerSecond * SECONDS_PER_HOUR;
  const eventsPerDay = eventsPerSecond * SECONDS_PER_DAY;
  const requestsPerSecond = eventsPerSecond / EVENTS_PER_REQUEST;
  const requestsPerMinute = requestsPerSecond * SECONDS_PER_MINUTE;
  const requestsPerHour = requestsPerSecond * SECONDS_PER_HOUR;
  const requestsPerDay = eventsPerDay / EVENTS_PER_REQUEST;
  
  const bytesPerSecond = requestsPerSecond * totalPerRequestBytes;
  const bytesPerMinute = bytesPerSecond * SECONDS_PER_MINUTE;
  const bytesPerHour = bytesPerSecond * SECONDS_PER_HOUR;
  const bytesPerDay = requestsPerDay * totalPerRequestBytes;
  const bytesPerMonth = bytesPerDay * 30;
  
  const mbPerDay = bytesPerDay / (1024 * 1024);
  const gbPerDay = bytesPerDay / (1024 * 1024 * 1024);
  const gbPerMonth = bytesPerMonth / (1024 * 1024 * 1024);
  const tbPerMonth = gbPerMonth / 1024;
  
  return {
    eventsPerSecond,
    requestsPerSecond,
    bytesPerSecond,
    bytesPerMinute,
    bytesPerHour,
    bytesPerDay,
    bytesPerMonth,
    mbPerDay,
    gbPerDay,
    gbPerMonth,
    tbPerMonth,
  };
}

// Calculate for different event rates (expanded)
const eventRates = [100, 500, 1000, 2000, 5000, 10000, 20000];
const calculations = eventRates.map((rate) => calculateStorage(rate));

// Display Results Table
console.log('='.repeat(150));
console.log('UNCOMPRESSED STORAGE REQUIREMENTS FOR DIFFERENT EVENT RATES');
console.log('Tenant-based system: Customers provide their own database infrastructure');
console.log('='.repeat(150));
console.log(
  'Events/sec'.padEnd(15) +
  'Reqs/sec'.padEnd(12) +
  'MB/sec'.padEnd(12) +
  'MB/min'.padEnd(12) +
  'MB/hour'.padEnd(12) +
  'MB/day'.padEnd(15) +
  'GB/day'.padEnd(12) +
  'GB/month'.padEnd(15) +
  'TB/month'
);
console.log('-'.repeat(150));

calculations.forEach((calc) => {
  const eventsPerSecStr = calc.eventsPerSecond.toLocaleString().padEnd(15);
  const reqsPerSecStr = calc.requestsPerSecond.toLocaleString('en-US', {maximumFractionDigits: 1}).padEnd(12);
  const mbPerSecStr = (calc.bytesPerSecond / (1024 * 1024)).toFixed(3).padEnd(12);
  const mbPerMinStr = (calc.bytesPerMinute / (1024 * 1024)).toFixed(2).padEnd(12);
  const mbPerHourStr = (calc.bytesPerHour / (1024 * 1024)).toFixed(2).padEnd(12);
  const mbPerDayStr = calc.mbPerDay.toFixed(2).padEnd(15);
  const gbPerDayStr = calc.gbPerDay.toFixed(3).padEnd(12);
  const gbPerMonthStr = calc.gbPerMonth.toFixed(2).padEnd(15);
  const tbPerMonthStr = calc.tbPerMonth.toFixed(3);
  
  console.log(eventsPerSecStr + reqsPerSecStr + mbPerSecStr + mbPerMinStr + mbPerHourStr + mbPerDayStr + gbPerDayStr + gbPerMonthStr + tbPerMonthStr);
});

console.log('='.repeat(150));
console.log();

// Detailed Breakdown for Enterprise Scenarios
console.log('='.repeat(150));
console.log('DETAILED BREAKDOWN - TENANT STORAGE REQUIREMENTS');
console.log('='.repeat(150));
console.log();

const detailedScenarios = [
  { rate: 100, name: 'Small Enterprise' },
  { rate: 500, name: 'Medium Enterprise' },
  { rate: 1000, name: 'Large Enterprise' },
  { rate: 2000, name: 'Very Large Enterprise' },
  { rate: 5000, name: 'Multi-Location Enterprise' },
  { rate: 10000, name: 'Global Enterprise' },
  { rate: 20000, name: 'Massive Multi-Tenant Cluster' },
];

detailedScenarios.forEach(({ rate, name }) => {
  const calc = calculateStorage(rate);
  console.log(`📊 ${name.toUpperCase()} (${rate} events/second)`);
  console.log(`   Requests/second:     ${calc.requestsPerSecond.toFixed(1)}`);
  console.log(`   Throughput (raw):`);
  console.log(`     • ${(calc.bytesPerSecond / (1024 * 1024)).toFixed(3)} MB/sec`);
  console.log(`     • ${(calc.bytesPerMinute / (1024 * 1024)).toFixed(2)} MB/min`);
  console.log(`     • ${(calc.bytesPerHour / (1024 * 1024 * 1024)).toFixed(2)} GB/hour`);
  console.log(`   Daily Storage:`);
  console.log(`     • ${calc.mbPerDay.toFixed(2)} MB`);
  console.log(`     • ${calc.gbPerDay.toFixed(2)} GB`);
  console.log(`   Monthly Storage (30-day retention):`);
  console.log(`     • ${(calc.mbPerDay * 30).toFixed(0)} MB`);
  console.log(`     • ${calc.gbPerMonth.toFixed(2)} GB`);
  console.log(`     • ${calc.tbPerMonth.toFixed(3)} TB`);
  console.log();
});

// Database SLA Requirements
console.log('='.repeat(150));
console.log('DATABASE INFRASTRUCTURE REQUIREMENTS FOR TENANT-PROVIDED DEPLOYMENTS');
console.log('='.repeat(150));
console.log();

const dbRequirements = [
  { rate: 100, db: 'PostgreSQL', iops: '500-1000 IOPS', diskSize: '36 GB/month', notes: 'Single instance sufficient' },
  { rate: 500, db: 'PostgreSQL', iops: '2500-5000 IOPS', diskSize: '180 GB/month', notes: 'High IOPS instance recommended' },
  { rate: 1000, db: 'PostgreSQL/MySQL', iops: '5000-10000 IOPS', diskSize: '360 GB/month', notes: 'Consider replication' },
  { rate: 2000, db: 'PostgreSQL Cluster', iops: '10000-20000 IOPS', diskSize: '720 GB/month', notes: 'Sharding recommended' },
  { rate: 5000, db: 'ClickHouse', iops: '20000-50000 IOPS', diskSize: '1.8 TB/month', notes: 'Distributed cluster essential' },
  { rate: 10000, db: 'ClickHouse Distributed', iops: '50000+ IOPS', diskSize: '3.6 TB/month', notes: 'Multiple nodes, load balancing' },
  { rate: 20000, db: 'ClickHouse Enterprise', iops: '100000+ IOPS', diskSize: '7.2 TB/month', notes: 'Full enterprise setup required' },
];

console.log('Events/sec'.padEnd(15) + 'Recommended DB'.padEnd(25) + 'IOPS Needed'.padEnd(25) + 'Disk/Month'.padEnd(20) + 'Architecture Notes');
console.log('-'.repeat(150));

dbRequirements.forEach(({ rate, db, iops, diskSize, notes }) => {
  console.log(
    rate.toString().padEnd(15) +
    db.padEnd(25) +
    iops.padEnd(25) +
    diskSize.padEnd(20) +
    notes
  );
});

console.log();
console.log('='.repeat(150));
console.log();

// Quick Reference Table
console.log('='.repeat(150));
console.log('QUICK REFERENCE - MONTHLY STORAGE COSTS (Assuming customer provides infra)');
console.log('='.repeat(150));
console.log();

const storageRates = {
  'Local SSD (self-hosted)': 0,
  'AWS EBS (GP3)': 0.10,
  'AWS RDS (Multi-AZ)': 0.50,
  'Google Cloud SQL': 0.35,
  'Azure Database': 0.40,
  'DigitalOcean Managed DB': 0.30,
};

console.log('For 1000 events/second deployment:');
console.log('-'.repeat(150));

const calc1000 = calculateStorage(1000);
console.log('Storage needed: ' + calc1000.gbPerMonth.toFixed(2) + ' GB/month');
console.log();

Object.entries(storageRates).forEach(([provider, costPerGb]) => {
  const monthlyOps = (calc1000.gbPerMonth * 365 / 30 * 1000 * 1.5); // Rough IOPS-related cost
  const storageCost = calc1000.gbPerMonth * costPerGb;
  const totalEstimate = storageCost + (monthlyOps / 30000); // Rough estimate
  
  console.log(
    provider.padEnd(35) +
    `$${totalEstimate.toFixed(2)}/month`.padEnd(20) +
    `(${(calc1000.gbPerMonth * costPerGb).toFixed(2)} storage + ops)`
  );
});

console.log();
console.log('='.repeat(150));
console.log('Note: Costs are estimates for storage only. Actual costs vary by:');
console.log('  • Data transfer egress');
console.log('  • Backup & replication requirements');
console.log('  • IOPS and throughput scaling');
console.log('  • HA/DR setup (read replicas, multi-region)');
console.log('  • Query complexity and indexing strategy');
console.log('='.repeat(150));
