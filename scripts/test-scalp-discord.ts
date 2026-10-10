/**
 * Dry-run test for index-scalp Discord callouts. Builds the exact payload that
 * WOULD be posted (no live POST) so we can verify formatting before going live.
 *
 * Run: npx tsx --env-file=.env scripts/test-scalp-discord.ts
 */
import { sendIndexScalpToDiscord } from '../server/discord-service';

const samples = [
  {
    symbol: 'SPX', bias: 'puts' as const, setup: 'wall_break',
    suggestedStrike: 7290, expiryDate: '2026-06-08', spotPrice: 7350,
    target: 7286.4, stop: 7396.8, riskRewardRatio: 1.36, confidence: 72,
    thesis: 'Breaking put wall $735 in negative gamma — dealers chase downside. SPX PUTS for momentum.',
    premiumRange: '$0.80–$3.00', regime: 'negative_gamma', isPowerHour: false,
  },
  {
    symbol: 'QQQ', bias: 'calls' as const, setup: 'wall_fade',
    suggestedStrike: 495, expiryDate: '2026-06-08', spotPrice: 491,
    target: 494.93, stop: 488.53, riskRewardRatio: 1.59, confidence: 68,
    thesis: 'Pinned at put wall $490 — positive gamma dealers buy dips. QQQ CALLS for bounce.',
    premiumRange: '$0.80–$3.00', regime: 'positive_gamma', isPowerHour: false,
  },
  {
    symbol: 'SPX', bias: 'puts' as const, setup: 'power_hour',
    suggestedStrike: 7320, expiryDate: '2026-06-08', spotPrice: 7350,
    target: 7300, stop: 7372.05, riskRewardRatio: 2.27, confidence: 70,
    thesis: '⚡ POWER HOUR — negative_gamma regime, dealers amplifying moves. SPX PUTS for 45min sprint to put wall.',
    premiumRange: '$2.50–$8.00', regime: 'negative_gamma', isPowerHour: true,
  },
];

(async () => {
  console.log('\n=== INDEX SCALP → DISCORD CALLOUT (DRY RUN) ===\n');
  for (const s of samples) {
    const res = await sendIndexScalpToDiscord(s, { dryRun: true });
    const p = res.payload;
    console.log('content:', p.content);
    console.log('embed.title:', p.embeds[0].title);
    console.log('embed.color:', '#' + p.embeds[0].color.toString(16));
    console.log('embed.fields:', p.embeds[0].fields.map((f: any) => `${f.name}=${f.value}`).join(' | '));
    console.log('embed.footer:', p.embeds[0].footer.text);
    console.log('---');
  }
  console.log('\nWebhook target on live: DISCORD_WEBHOOK_SPX', process.env.DISCORD_WEBHOOK_SPX ? '✅ configured' : '❌ NOT set');
  console.log('Fallbacks: LOTTO', process.env.DISCORD_WEBHOOK_LOTTO ? '✅' : '—', '| OPTIONSTRADES', process.env.DISCORD_WEBHOOK_OPTIONSTRADES ? '✅' : '—', '| URL', process.env.DISCORD_WEBHOOK_URL ? '✅' : '—');
  console.log('\n🎯 DRY RUN COMPLETE — no messages posted.\n');
  process.exit(0);
})();
