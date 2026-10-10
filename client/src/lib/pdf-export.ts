import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { safeToFixed } from './utils';

// Extend jsPDF with autoTable type
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

export async function generateDailyTradeAnalysisPDF(ideas: any[]) {
  const doc = new jsPDF();
  const date = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  // Header
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, 210, 40, 'F');
  
  doc.setTextColor(34, 211, 238); // cyan-400
  doc.setFontSize(24);
  doc.text('Quant Edge Labs', 14, 20);
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.text('Daily Trade Analysis & Risk Documentation', 14, 30);
  doc.text(date, 140, 30);

  let yPos = 50;

  ideas.forEach((idea, index) => {
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
    }

    // Idea Header
    doc.setFillColor(241, 245, 249);
    doc.rect(14, yPos, 182, 10, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`${idea.symbol} - ${idea.assetType.toUpperCase()} ${idea.optionType ? idea.optionType.toUpperCase() : ''}`, 18, yPos + 7);
    
    yPos += 15;

    // Details Table
    const details = [
      ['Entry Price', `$${idea.entryPrice}`, 'Target Price', `$${idea.targetPrice}`],
      ['Stop Loss', `$${idea.stopLoss}`, 'R:R Ratio', safeToFixed(idea.riskRewardRatio, 2, 'N/A')],
      ['Signal Strength', `${idea.confidenceScore}pts`, 'Source', idea.source?.toUpperCase() || 'QUANT'],
    ];

    doc.autoTable({
      startY: yPos,
      head: [],
      body: details,
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: 'bold', width: 30 },
        1: { width: 40 },
        2: { fontStyle: 'bold', width: 30 },
        3: { width: 40 },
      },
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;

    // Catalyst & Analysis
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Trade Catalyst:', 14, yPos);
    yPos += 5;
    doc.setFont('helvetica', 'normal');
    const catalystLines = doc.splitTextToSize(idea.catalyst || 'No catalyst documented.', 180);
    doc.text(catalystLines, 14, yPos);
    yPos += (catalystLines.length * 5) + 5;

    doc.setFont('helvetica', 'bold');
    doc.text('Risk Analysis & Documentation:', 14, yPos);
    yPos += 5;
    doc.setFont('helvetica', 'normal');
    const analysisLines = doc.splitTextToSize(idea.analysis || 'No detailed analysis available.', 180);
    doc.text(analysisLines, 14, yPos);
    yPos += (analysisLines.length * 5) + 15;
  });

  // Footer on all pages
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Confidential - For Educational & Research Purposes Only. Not Financial Advice.', 105, 290, { align: 'center' });
  }

  doc.save(`QuantEdgeLabs_Analysis_${new Date().toISOString().split('T')[0]}.pdf`);
}

// Engine labels for display
const ENGINE_LABELS: Record<string, string> = {
  ai: "AI Engine",
  quant: "Quant Engine",
  hybrid: "Hybrid Engine",
  flow: "Flow Scanner",
  lotto: "Lotto Scanner",
};

interface PlatformReportData {
  id?: string;
  period: string;
  startDate: string;
  endDate: string;
  totalIdeasGenerated: number;
  aiIdeasGenerated?: number;
  quantIdeasGenerated?: number;
  hybridIdeasGenerated?: number;
  totalTradesResolved?: number;
  totalWins?: number;
  totalLosses?: number;
  overallWinRate?: number | null;
  avgGainPercent?: number | null;
  avgLossPercent?: number | null;
  totalPnlPercent?: number | null;
  aiWinRate?: number | null;
  quantWinRate?: number | null;
  hybridWinRate?: number | null;
  bestPerformingEngine?: string | null;
  autoLottoTrades?: number;
  autoLottoPnl?: number | null;
  futuresBotTrades?: number;
  futuresBotPnl?: number | null;
  cryptoBotTrades?: number;
  cryptoBotPnl?: number | null;
  propFirmTrades?: number;
  propFirmPnl?: number | null;
  stockTradeCount?: number;
  optionsTradeCount?: number;
  cryptoTradeCount?: number;
  futuresTradeCount?: number;
  topWinningSymbols?: Array<{ symbol: string; wins: number; losses: number; totalPnl: number }>;
  topLosingSymbols?: Array<{ symbol: string; wins: number; losses: number; totalPnl: number }>;
  reportData?: {
    enginePerformance?: Array<{
      engine: string;
      generated: number;
      resolved: number;
      wins: number;
      losses: number;
      winRate: number;
    }>;
  };
}

export function generatePlatformReportPDF(report: PlatformReportData) {
  const doc = new jsPDF();
  const periodLabel = report.period.charAt(0).toUpperCase() + report.period.slice(1);
  
  // Header - Dark blue background
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, 210, 45, 'F');
  
  // Logo / Title
  doc.setTextColor(34, 211, 238); // cyan-400
  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.text('Quant Edge Labs', 14, 22);
  
  // Subtitle
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text(`${periodLabel} Platform Report`, 14, 32);
  
  // Date range - right aligned
  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184); // slate-400
  const dateRange = `${report.startDate} to ${report.endDate}`;
  doc.text(dateRange, 196, 32, { align: 'right' });
  
  let yPos = 55;
  
  // Executive Summary Section
  doc.setFillColor(241, 245, 249); // slate-100
  doc.rect(14, yPos, 182, 8, 'F');
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('EXECUTIVE SUMMARY', 18, yPos + 6);
  yPos += 14;
  
  // Key Metrics Table
  const winRate = safeToFixed(report.overallWinRate, 1, '—');
  const totalPnl = safeToFixed(report.totalPnlPercent, 2, '—');
  const pnlColor = (report.totalPnlPercent || 0) >= 0 ? [34, 197, 94] : [239, 68, 68]; // green or red
  
  const summaryData = [
    ['Ideas Generated', String(report.totalIdeasGenerated), 'Trades Resolved', String(report.totalTradesResolved || 0)],
    ['Total Wins', String(report.totalWins || 0), 'Total Losses', String(report.totalLosses || 0)],
    ['Win Rate', `${winRate}%`, 'Total P&L', `${totalPnl}%`],
    ['Best Engine', ENGINE_LABELS[report.bestPerformingEngine || ''] || '—', 'Avg Gain', `${safeToFixed(report.avgGainPercent, 2, '—')}%`],
  ];
  
  doc.autoTable({
    startY: yPos,
    head: [],
    body: summaryData,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 35, textColor: [100, 116, 139] },
      1: { cellWidth: 50, textColor: [15, 23, 42] },
      2: { fontStyle: 'bold', cellWidth: 35, textColor: [100, 116, 139] },
      3: { cellWidth: 50, textColor: [15, 23, 42] },
    },
  });
  
  yPos = (doc as any).lastAutoTable.finalY + 15;
  
  // Engine Performance Section
  doc.setFillColor(241, 245, 249);
  doc.rect(14, yPos, 182, 8, 'F');
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('ENGINE PERFORMANCE COMPARISON', 18, yPos + 6);
  yPos += 12;
  
  const engineData: (string | number)[][] = [
    ['Engine', 'Generated', 'Resolved', 'Wins', 'Losses', 'Win Rate'],
  ];
  
  // Add engine-specific data from reportData if available
  if (report.reportData?.enginePerformance) {
    for (const eng of report.reportData.enginePerformance) {
      engineData.push([
        ENGINE_LABELS[eng.engine] || eng.engine,
        eng.generated,
        eng.resolved,
        eng.wins,
        eng.losses,
        `${safeToFixed(eng.winRate, 1, '—')}%`,
      ]);
    }
  } else {
    // Fallback to top-level data
    if (report.aiIdeasGenerated) {
      engineData.push(['AI Engine', report.aiIdeasGenerated, '—', '—', '—', `${safeToFixed(report.aiWinRate, 1, '—')}%`]);
    }
    if (report.quantIdeasGenerated) {
      engineData.push(['Quant Engine', report.quantIdeasGenerated, '—', '—', '—', `${safeToFixed(report.quantWinRate, 1, '—')}%`]);
    }
    if (report.hybridIdeasGenerated) {
      engineData.push(['Hybrid Engine', report.hybridIdeasGenerated, '—', '—', '—', `${safeToFixed(report.hybridWinRate, 1, '—')}%`]);
    }
  }
  
  doc.autoTable({
    startY: yPos,
    head: [engineData[0]],
    body: engineData.slice(1),
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 2 },
  });
  
  yPos = (doc as any).lastAutoTable.finalY + 15;
  
  // Check if we need a new page
  if (yPos > 200) {
    doc.addPage();
    yPos = 20;
  }
  
  // Bot Activity Section
  doc.setFillColor(241, 245, 249);
  doc.rect(14, yPos, 182, 8, 'F');
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('BOT ACTIVITY SUMMARY', 18, yPos + 6);
  yPos += 12;
  
  const botData = [
    ['Bot Type', 'Trades', 'P&L'],
    ['Auto-Lotto', String(report.autoLottoTrades || 0), `${safeToFixed(report.autoLottoPnl, 2)}%`],
    ['Futures Bot', String(report.futuresBotTrades || 0), `${safeToFixed(report.futuresBotPnl, 2)}%`],
    ['Crypto Bot', String(report.cryptoBotTrades || 0), `${safeToFixed(report.cryptoBotPnl, 2)}%`],
    ['Prop Firm', String(report.propFirmTrades || 0), `${safeToFixed(report.propFirmPnl, 2)}%`],
  ];
  
  doc.autoTable({
    startY: yPos,
    head: [botData[0]],
    body: botData.slice(1),
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 40 },
      2: { cellWidth: 40 },
    },
  });
  
  yPos = (doc as any).lastAutoTable.finalY + 15;
  
  // Check if we need a new page
  if (yPos > 200) {
    doc.addPage();
    yPos = 20;
  }
  
  // Top Winning Symbols
  if (report.topWinningSymbols && report.topWinningSymbols.length > 0) {
    doc.setFillColor(241, 245, 249);
    doc.rect(14, yPos, 182, 8, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('TOP WINNING SYMBOLS', 18, yPos + 6);
    yPos += 12;
    
    const winnerData = [['Symbol', 'Wins', 'Losses', 'Total P&L']];
    for (const sym of report.topWinningSymbols.slice(0, 5)) {
      winnerData.push([sym.symbol, String(sym.wins), String(sym.losses), `+${safeToFixed(sym.totalPnl, 2)}%`]);
    }
    
    doc.autoTable({
      startY: yPos,
      head: [winnerData[0]],
      body: winnerData.slice(1),
      theme: 'striped',
      headStyles: { fillColor: [34, 197, 94], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 2 },
    });
    
    yPos = (doc as any).lastAutoTable.finalY + 10;
  }
  
  // Top Losing Symbols
  if (report.topLosingSymbols && report.topLosingSymbols.length > 0) {
    // Check if we need a new page
    if (yPos > 230) {
      doc.addPage();
      yPos = 20;
    }
    
    doc.setFillColor(241, 245, 249);
    doc.rect(14, yPos, 182, 8, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('TOP LOSING SYMBOLS', 18, yPos + 6);
    yPos += 12;
    
    const loserData = [['Symbol', 'Wins', 'Losses', 'Total P&L']];
    for (const sym of report.topLosingSymbols.slice(0, 5)) {
      loserData.push([sym.symbol, String(sym.wins), String(sym.losses), `${safeToFixed(sym.totalPnl, 2)}%`]);
    }
    
    doc.autoTable({
      startY: yPos,
      head: [loserData[0]],
      body: loserData.slice(1),
      theme: 'striped',
      headStyles: { fillColor: [239, 68, 68], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 2 },
    });
  }
  
  // Footer on all pages
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Confidential - For Educational & Research Purposes Only. Not Financial Advice.', 105, 285, { align: 'center' });
    doc.text(`Generated: ${new Date().toLocaleString()} | Page ${i} of ${pageCount}`, 105, 290, { align: 'center' });
  }
  
  // Generate filename
  const dateStr = report.startDate.replace(/-/g, '');
  doc.save(`quantedgelabs-report-${report.period}-${dateStr}.pdf`);
}
