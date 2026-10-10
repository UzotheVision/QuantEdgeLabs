/**
 * The universal ticker-workup opener. Any board can call openWorkup('TSLA')
 * without threading a context through five component trees — the shell
 * listens and renders the modal over whatever tab is showing.
 */
const EVENT = 'qe:workup';

export function openWorkup(symbol: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { symbol: symbol.toUpperCase() } }));
}

export function onWorkup(handler: (symbol: string) => void): () => void {
  const fn = (e: Event) => {
    const sym = (e as CustomEvent).detail?.symbol;
    if (typeof sym === 'string' && sym) handler(sym);
  };
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
