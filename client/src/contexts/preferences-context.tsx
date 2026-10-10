import { createContext, useContext, useCallback, useMemo, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

export type LayoutDensity = "compact" | "comfortable" | "spacious";
export type DashboardPreset = "default" | "analytics" | "trading" | "minimal";

export interface WidgetConfig {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  locked?: boolean;
  config?: Record<string, unknown>;
}

export interface PageLayout {
  id?: string;
  pageId: string;
  layoutName: string;
  widgets: WidgetConfig[];
  columns: number;
  rowHeight: number;
  panelSizes?: Record<string, number> | null;
  isDefault: boolean;
}

export interface UserUIPreferences {
  layoutDensity: LayoutDensity;
  sidebarCollapsed: boolean;
  dashboardPreset: DashboardPreset;
  favoritePages: string[];
  theme: "dark" | "light";
  compactMode: boolean;
}

interface PreferencesContextValue {
  preferences: UserUIPreferences;
  isLoading: boolean;
  updatePreference: <K extends keyof UserUIPreferences>(
    key: K,
    value: UserUIPreferences[K]
  ) => Promise<void>;
  saveLayout: (pageId: string, layout: Partial<PageLayout>) => Promise<void>;
  getLayout: (pageId: string) => PageLayout | undefined;
  layouts: Map<string, PageLayout>;
  densityClass: string;
}

const defaultPreferences: UserUIPreferences = {
  layoutDensity: "comfortable",
  sidebarCollapsed: false,
  dashboardPreset: "default",
  favoritePages: [],
  theme: "dark",
  compactMode: false,
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = (user as { id?: string } | null)?.id || "guest";

  const { data: preferences = defaultPreferences, isLoading } = useQuery<UserUIPreferences>({
    queryKey: ["/api/user", userId, "preferences"],
    enabled: !!userId,
  });

  const { data: layoutsData = [] } = useQuery<PageLayout[]>({
    queryKey: ["/api/user", userId, "layouts"],
    enabled: !!userId,
  });

  const layouts = useMemo(() => {
    const map = new Map<string, PageLayout>();
    layoutsData.forEach((l) => map.set(l.pageId, l));
    return map;
  }, [layoutsData]);

  const prefMutation = useMutation({
    mutationFn: async (prefs: Partial<UserUIPreferences>) => {
      return apiRequest("PATCH", `/api/user/${userId}/preferences`, prefs);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user", userId, "preferences"] });
    },
  });

  const layoutMutation = useMutation({
    mutationFn: async ({ pageId, layout }: { pageId: string; layout: Partial<PageLayout> }) => {
      return apiRequest("PUT", `/api/user/${userId}/layouts/${pageId}`, layout);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user", userId, "layouts"] });
    },
  });

  const updatePreference = useCallback(
    async <K extends keyof UserUIPreferences>(key: K, value: UserUIPreferences[K]) => {
      await prefMutation.mutateAsync({ [key]: value });
    },
    [prefMutation]
  );

  const saveLayout = useCallback(
    async (pageId: string, layout: Partial<PageLayout>) => {
      await layoutMutation.mutateAsync({ pageId, layout: { ...layout, pageId } });
    },
    [layoutMutation]
  );

  const getLayout = useCallback(
    (pageId: string) => layouts.get(pageId),
    [layouts]
  );

  const densityClass = useMemo(() => {
    switch (preferences.layoutDensity) {
      case "compact":
        return "density-compact";
      case "spacious":
        return "density-spacious";
      default:
        return "density-comfortable";
    }
  }, [preferences.layoutDensity]);

  const value: PreferencesContextValue = {
    preferences,
    isLoading,
    updatePreference,
    saveLayout,
    getLayout,
    layouts,
    densityClass,
  };

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }
  return context;
}
