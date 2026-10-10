import { Link } from 'wouter';
import {
  Activity, Bitcoin, Bot, BookOpen, CalendarDays, CandlestickChart,
  Grid3X3, Radar, TrendingUp, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import qeMark from '@assets/qe-mark.svg';
import { PAGES, TABS, UTILITY_PAGES, tabHref, type Tab } from './nav-model';

const TAB_ICONS: Record<Tab, typeof Radar> = {
  oracle: Radar,
  chart: CandlestickChart,
  flow: Activity,
  gex: Grid3X3,
  leaps: TrendingUp,
  crypto: Bitcoin,
  catalyst: CalendarDays,
  bot: Bot,
  positions: Wallet,
  journal: BookOpen,
};

const GROUPS: Array<{ label: string; tabs: Tab[] }> = [
  { label: 'Workspace', tabs: ['oracle', 'chart', 'flow', 'gex'] },
  { label: 'Research', tabs: ['leaps', 'crypto', 'catalyst'] },
  { label: 'Operations', tabs: ['bot', 'positions', 'journal'] },
];

export function DesktopRail({
  activeTab,
  currentPath,
  onTab,
}: {
  activeTab?: Tab | null;
  currentPath?: string;
  onTab?: (tab: Tab) => void;
}) {
  return (
    <aside className="qe-desktop-rail hidden lg:flex" aria-label="Primary navigation">
      <Link href="/today" className="qe-rail-brand" aria-label="QuantEdge home">
        <img src={qeMark} alt="" width={24} height={24} />
        <span><b>QUANTEDGE</b><small>RESEARCH TERMINAL</small></span>
      </Link>

      <nav className="qe-rail-nav">
        {GROUPS.map((group) => (
          <section key={group.label} className="qe-rail-group" aria-label={group.label}>
            <div className="qe-rail-label">{group.label}</div>
            {group.tabs.map((id) => {
              const item = TABS.find((tab) => tab.id === id)!;
              const Icon = TAB_ICONS[id];
              const active = activeTab === id;
              const body = <><Icon aria-hidden /><span>{item.label}</span>{active && <i aria-hidden />}</>;
              return onTab ? (
                <button key={id} type="button" className={cn('qe-rail-item', active && 'active')} onClick={() => onTab(id)} aria-current={active ? 'page' : undefined}>{body}</button>
              ) : (
                <Link key={id} href={tabHref(id)} className="qe-rail-item">{body}</Link>
              );
            })}
          </section>
        ))}

        <section className="qe-rail-group" aria-label="Daily workflow">
          <div className="qe-rail-label">Daily workflow</div>
          {PAGES.map((page) => {
            const Icon = page.icon;
            const active = currentPath === page.href;
            return <Link key={page.href} href={page.href} className={cn('qe-rail-item', active && 'active')} aria-current={active ? 'page' : undefined}><Icon aria-hidden /><span>{page.label}</span>{active && <i aria-hidden />}</Link>;
          })}
        </section>
      </nav>

      <div className="qe-rail-utility">
        {UTILITY_PAGES.map((page) => {
          const Icon = page.icon;
          const active = currentPath === page.href;
          return <Link key={page.href} href={page.href} className={cn('qe-rail-item', active && 'active')} aria-current={active ? 'page' : undefined}><Icon aria-hidden /><span>{page.label}</span></Link>;
        })}
        <div className="qe-rail-disclosure"><span />Decision support only<br />Data quality is surfaced</div>
      </div>
    </aside>
  );
}
