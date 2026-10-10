import { generateDiagnosticExport } from '../server/diagnostic-export';
import { writeFileSync } from 'fs';

async function main() {
  console.log('📊 Generating diagnostic exports...\n');
  
  // Generate 30-day summary export
  console.log('1️⃣ Creating 30-day summary export...');
  const summaryExport = await generateDiagnosticExport(30, false);
  writeFileSync(
    'diagnostic-export-30day.json',
    JSON.stringify(summaryExport, null, 2)
  );
  console.log('✅ Saved: diagnostic-export-30day.json\n');
  
  // Generate 90-day full export with raw data
  console.log('2️⃣ Creating 90-day full export with raw data...');
  const fullExport = await generateDiagnosticExport(90, true);
  writeFileSync(
    'diagnostic-export-90day-full.json',
    JSON.stringify(fullExport, null, 2)
  );
  console.log('✅ Saved: diagnostic-export-90day-full.json\n');
  
  console.log('🎯 Export Summary:');
  console.log(`   30-day trades: ${summaryExport.performanceAnalysis.overallMetrics.totalTrades}`);
  console.log(`   90-day trades: ${fullExport.performanceAnalysis.overallMetrics.totalTrades}`);
  console.log(`   Win rate (30d): ${summaryExport.performanceAnalysis.overallMetrics.winRate.toFixed(1)}%`);
  console.log(`   Win rate (90d): ${fullExport.performanceAnalysis.overallMetrics.winRate.toFixed(1)}%`);
  console.log('\n📂 Files ready for analysis!');
}

main().catch(console.error);
