/**
 * ONE NAVIGATION MODEL for the whole signed-in platform.
 *
 * The terminal (/t) and every standalone page (/slate, /radar,
 * /performance, /alerts, /how-to, /settings…) read their tabs, the mobile dock
 * and the "More" sheet from here. Before 2026-09-24 the standalone pages wore a
 * second, older design — a left sidebar with its own header and footer — so
 * moving between the board and a page changed the whole chrome under you.
 */
import {
  Activity, Bell, Bitcoin, Bot, BookOpen, CalendarDays, CandlestickChart, Crosshair,
  Grid3X3, HelpCircle, LineChart, ListChecks, Radar, SlidersHorizontal, TrendingUp, Wallet, Home,
} from 'lucide-react';

export type Tab = 'oracle' | 'chart' | 'flow' | 'gex' | 'leaps' | 'crypto' | 'catalyst' | 'bot' | 'positions' | 'journal';

export const TABS: { id: Tab; label: string }[] = [
  { id: 'oracle',  label: 'NEXUS' },
  { id: 'chart',   label: 'CHART' },
  { id: 'flow',    label: 'FLOW' },
  { id: 'gex',     label: 'GEX' },
  { id: 'leaps',   label: 'LEAPS' },
  { id: 'crypto',  label: 'CRYPTO' },
  { id: 'catalyst', label: 'CATALYST' },
  { id: 'bot',     label: 'BOT' },
  { id: 'positions', label: 'POSITIONS' },
  { id: 'journal',   label: 'JOURNAL' },
];

/** Four daily workflows one tap away on phones; everything else in "More". */
export const MOBILE_PRIMARY: Tab[] = ['oracle', 'chart', 'flow', 'gex'];
export const MOBILE_MORE: Tab[] = ['leaps', 'crypto', 'catalyst', 'bot', 'positions', 'journal'];

/** Standalone pages — same chrome as the terminal, reached from the nav and "More". */
export interface PageLink { href: string; label: string; short: string; icon: typeof Radar }
export const PAGES: PageLink[] = [
  { href: '/today',       label: 'Today',       short: 'TODAY',  icon: Home },
  { href: '/slate',       label: 'Slate',       short: 'SLATE',  icon: ListChecks },
  { href: '/radar',       label: 'Radar',       short: 'RADAR',  icon: Crosshair },
];
export const UTILITY_PAGES: PageLink[] = [
  { href: '/alerts',   label: 'Alerts',   short: 'ALERTS',   icon: Bell },
  { href: '/how-to',   label: 'How to use', short: 'GUIDE',  icon: HelpCircle },
  { href: '/settings', label: 'Settings', short: 'SETTINGS', icon: SlidersHorizontal },
];

export function tabHref(t: Tab) { return t === 'oracle' ? '/t' : `/t?tab=${t}`; }

export function MobileTabIcon({ tab }: { tab: Tab }) {
  const c = 'h-[18px] w-[18px]';
  if (tab === 'oracle') return <Radar className={c} />;
  if (tab === 'chart') return <CandlestickChart className={c} />;
  if (tab === 'flow') return <Activity className={c} />;
  if (tab === 'gex') return <Grid3X3 className={c} />;
  if (tab === 'leaps') return <TrendingUp className={c} />;
  if (tab === 'crypto') return <Bitcoin className={c} />;
  if (tab === 'catalyst') return <CalendarDays className={c} />;
  if (tab === 'positions') return <Wallet className={c} />;
  if (tab === 'journal') return <BookOpen className={c} />;
  return <Bot className={c} />;
}
