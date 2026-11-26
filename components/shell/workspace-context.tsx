"use client";

import * as React from "react";

export interface SearchProfileSummary {
  id: string;
  name: string;
  isDefault?: boolean;
}

export interface WorkspaceContextValue {
  searchProfiles: SearchProfileSummary[];
  activeProfileId: string | null;
  setActiveProfileId: (id: string | null) => void;
  refreshSearchProfiles: () => Promise<void>;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

const SIDEBAR_STORAGE_KEY = "pjc.sidebar.collapsed";
const ACTIVE_PROFILE_STORAGE_KEY = "pjc.active-profile-id";

async function fetchSearchProfilesList(): Promise<SearchProfileSummary[] | null> {
  try {
    const response = await fetch("/api/search-profiles", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return null;
    }
    const data: unknown = await response.json();
    const rawList = Array.isArray(data)
      ? data
      : data &&
          typeof data === "object" &&
          Array.isArray((data as { items?: unknown }).items)
        ? (data as { items: unknown[] }).items
        : [];

    return rawList
      .filter(
        (item): item is { id: string; name: string; isDefault?: boolean } =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as { id?: unknown }).id === "string" &&
              typeof (item as { name?: unknown }).name === "string"
          )
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        isDefault: Boolean(item.isDefault),
      }));
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [searchProfiles, setSearchProfiles] = React.useState<SearchProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileIdState] = React.useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsedState] = React.useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = React.useState(false);

  // Hydrate persisted preferences & responsive rail collapse after mount via async microtask.
  React.useEffect(() => {
    let active = true;

    Promise.resolve().then(() => {
      if (!active || typeof window === "undefined") return;

      const storedProfile = window.localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
      if (storedProfile) {
        setActiveProfileIdState(storedProfile);
      }

      const storedCollapsed = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (window.innerWidth < 1280) {
        setSidebarCollapsedState(true);
      } else if (storedCollapsed !== null) {
        setSidebarCollapsedState(storedCollapsed === "true");
      }
    });

    void fetchSearchProfilesList().then((parsed) => {
      if (!active || !parsed) return;
      setSearchProfiles(parsed);
      setActiveProfileIdState((prev) => {
        if (prev && parsed.some((p) => p.id === prev)) {
          return prev;
        }
        const fallback = parsed.find((p) => p.isDefault) ?? parsed[0] ?? null;
        return fallback ? fallback.id : null;
      });
    });

    return () => {
      active = false;
    };
  }, []);

  const setSidebarCollapsed = React.useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    }
  }, []);

  const toggleSidebar = React.useCallback(() => {
    setSidebarCollapsedState((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      }
      return next;
    });
  }, []);

  const setActiveProfileId = React.useCallback((id: string | null) => {
    setActiveProfileIdState(id);
    if (typeof window !== "undefined") {
      if (id) {
        window.localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, id);
      } else {
        window.localStorage.removeItem(ACTIVE_PROFILE_STORAGE_KEY);
      }
    }
  }, []);

  const refreshSearchProfiles = React.useCallback(async () => {
    const parsed = await fetchSearchProfilesList();
    if (!parsed) return;
    setSearchProfiles(parsed);
    setActiveProfileIdState((prev) => {
      if (prev && parsed.some((p) => p.id === prev)) {
        return prev;
      }
      const fallback = parsed.find((p) => p.isDefault) ?? parsed[0] ?? null;
      return fallback ? fallback.id : null;
    });
  }, []);

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      searchProfiles,
      activeProfileId,
      setActiveProfileId,
      refreshSearchProfiles,
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebar,
      commandPaletteOpen,
      setCommandPaletteOpen,
    }),
    [
      activeProfileId,
      commandPaletteOpen,
      refreshSearchProfiles,
      searchProfiles,
      setActiveProfileId,
      setSidebarCollapsed,
      sidebarCollapsed,
      toggleSidebar,
    ]
  );

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
