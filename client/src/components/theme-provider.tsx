import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "night" | "nexus" | "nexus-light" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "quantedge-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark", "terminal-night", "terminal-nexus", "terminal-nexus-light");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";

      root.classList.add(systemTheme);
      return;
    }

    // Night is not a second fake dark theme: it inherits the semantic dark
    // palette, then narrows the surfaces for a lower-luminance desk setting.
    if (theme === "night") {
      root.classList.add("dark", "terminal-night");
      return;
    }

    // Nexus is the operator's reference-terminal palette, verbatim — teal-cyan
    // accents, saturated bull/bear, cyan-tinted borders. Same mechanism as
    // night: inherit dark's semantics, override the tokens.
    if (theme === "nexus") {
      root.classList.add("dark", "terminal-nexus");
      return;
    }

    // The day-shift half of the reference palette: light ground, same accent
    // hues at contrast-correct luminance.
    if (theme === "nexus-light") {
      root.classList.add("light", "terminal-nexus-light");
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
