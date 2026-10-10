import { useEffect, useRef, useCallback } from 'react';
import { useLocation, useSearch } from 'wouter';
import type { UserActivityType } from '@shared/schema';

const SESSION_KEY = 'qel_session_id';
const CSRF_TOKEN_KEY = 'qel_csrf_token';

function getSessionId(): string {
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }
  return sessionId;
}

// Fetch and cache CSRF token for POST requests
let csrfTokenPromise: Promise<string> | null = null;

async function getCsrfToken(): Promise<string> {
  // Check cache first
  let token = sessionStorage.getItem(CSRF_TOKEN_KEY);
  if (token) return token;
  
  // Only fetch once (reuse promise for concurrent calls)
  if (!csrfTokenPromise) {
    csrfTokenPromise = (async () => {
      try {
        const response = await fetch('/api/csrf-token', { credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          const fetchedToken = data.csrfToken;
          if (fetchedToken) {
            sessionStorage.setItem(CSRF_TOKEN_KEY, fetchedToken);
            return fetchedToken;
          }
        }
      } catch {
        // Silently fail - analytics shouldn't break the app
      }
      return '';
    })();
  }
  
  return csrfTokenPromise;
}

function getUTMParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get('utm_source') || undefined,
    utmMedium: params.get('utm_medium') || undefined,
    utmCampaign: params.get('utm_campaign') || undefined,
  };
}

export function usePageTracking() {
  const [pathOnly] = useLocation();
  // Terminal tabs live in ?tab= / ?jtab=; without them every tab logged as "/t"
  // and per-surface usage could not be measured (purpose review 2026-09-24).
  const search = useSearch();
  const sp = new URLSearchParams(search);
  const keep = ['tab', 'jtab'].filter((k) => sp.get(k)).map((k) => `${k}=${sp.get(k)}`).join('&');
  const location = keep ? `${pathOnly}?${keep}` : pathOnly;
  const pageViewIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    const sessionId = getSessionId();
    const utmParams = getUTMParams();
    
    const trackPageView = async () => {
      try {
        const csrfToken = await getCsrfToken();
        const response = await fetch('/api/tracking/pageview', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            ...(csrfToken && { 'X-CSRF-Token': csrfToken })
          },
          credentials: 'include',
          body: JSON.stringify({
            path: location,
            referrer: document.referrer,
            sessionId,
            ...utmParams,
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          pageViewIdRef.current = data.id;
          startTimeRef.current = Date.now();
        }
      } catch (error) {
        console.debug('Failed to track page view:', error);
      }
    };

    trackPageView();

    return () => {
      if (pageViewIdRef.current) {
        const timeOnPage = Math.round((Date.now() - startTimeRef.current) / 1000);
        navigator.sendBeacon(
          `/api/tracking/pageview/${pageViewIdRef.current}`,
          JSON.stringify({ timeOnPage })
        );
      }
    };
  }, [location]);
}

export function useActivityTracking() {
  const trackActivity = useCallback(async (
    activityType: UserActivityType,
    description?: string,
    metadata?: Record<string, unknown>
  ) => {
    try {
      const sessionId = getSessionId();
      const csrfToken = await getCsrfToken();
      await fetch('/api/tracking/activity', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken })
        },
        credentials: 'include',
        body: JSON.stringify({
          activityType,
          description,
          metadata,
          sessionId,
        }),
      });
    } catch (error) {
      console.debug('Failed to track activity:', error);
    }
  }, []);

  return { trackActivity };
}

export function useTradeIdeaTracking() {
  const { trackActivity } = useActivityTracking();

  const trackViewIdea = useCallback((ideaId: string, symbol: string) => {
    trackActivity('view_trade_idea', `Viewed trade idea: ${symbol}`, { ideaId, symbol });
  }, [trackActivity]);

  const trackGenerateIdea = useCallback((symbol: string, source: string) => {
    trackActivity('generate_idea', `Generated idea for ${symbol}`, { symbol, source });
  }, [trackActivity]);

  const trackViewChart = useCallback((symbol: string) => {
    trackActivity('view_chart', `Viewed chart: ${symbol}`, { symbol });
  }, [trackActivity]);

  const trackExportPdf = useCallback((type: string) => {
    trackActivity('export_pdf', `Exported PDF: ${type}`, { type });
  }, [trackActivity]);

  const trackAddToWatchlist = useCallback((symbol: string) => {
    trackActivity('add_to_watchlist', `Added to watchlist: ${symbol}`, { symbol });
  }, [trackActivity]);

  const trackJournalEntry = useCallback((ideaId?: string) => {
    trackActivity('journal_entry', 'Created journal entry', { ideaId });
  }, [trackActivity]);

  const trackRunScanner = useCallback((scannerType: string) => {
    trackActivity('run_scanner', `Ran scanner: ${scannerType}`, { scannerType });
  }, [trackActivity]);

  return {
    trackViewIdea,
    trackGenerateIdea,
    trackViewChart,
    trackExportPdf,
    trackAddToWatchlist,
    trackJournalEntry,
    trackRunScanner,
  };
}
