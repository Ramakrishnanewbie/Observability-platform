"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { observoApi } from "@/lib/observo-api";

export type DataSource = {
  id: string;
  name: string;
  type: string;
  status: string;
  config?: Record<string, string>;
};

type DatasourceContextType = {
  datasources: DataSource[];
  selectedDS: DataSource | null;
  setSelectedDS: (ds: DataSource | null) => void;
  // Derived helpers used by all pages
  selectedHost: string;        // e.g. "gcp-project-xxx" or "docker-desktop" or ""
  isGCP: boolean;
  isAllHosts: boolean;
  refresh: () => void;
};

const DatasourceContext = createContext<DatasourceContextType>({
  datasources: [],
  selectedDS: null,
  setSelectedDS: () => {},
  selectedHost: "",
  isGCP: false,
  isAllHosts: true,
  refresh: () => {},
});

export function DatasourceProvider({ children }: { children: ReactNode }) {
  const [datasources, setDatasources] = useState<DataSource[]>([]);
  const [selectedDS, setSelectedDS] = useState<DataSource | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await observoApi.getDataSources();
      const connected = (data as DataSource[]).filter(d => d.status === "connected");
      setDatasources(connected);
      // Auto-select first on first load, but don't override user's choice
      setSelectedDS(prev => {
        if (prev) {
          // Re-validate: if previously selected still exists keep it
          const still = connected.find(d => d.id === prev.id);
          return still || (connected[0] ?? null);
        }
        return connected[0] ?? null;
      });
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Derive a host string from the selected datasource
  const selectedHost = selectedDS
    ? selectedDS.type === "gcp"
      ? `gcp-${selectedDS.config?.gcp_project_id || ""}`.replace(/\s/g, "-")
      : selectedDS.type === "aws"
        ? `aws-${selectedDS.config?.aws_region || ""}`
        : selectedDS.type === "azure"
          ? `azure-${selectedDS.config?.azure_subscription_id || ""}`
          : ""
    : "";

  const isGCP = selectedDS?.type === "gcp";
  const isAllHosts = !selectedDS;

  return (
    <DatasourceContext.Provider value={{
      datasources, selectedDS, setSelectedDS,
      selectedHost, isGCP, isAllHosts, refresh,
    }}>
      {children}
    </DatasourceContext.Provider>
  );
}

export function useDatasource() {
  return useContext(DatasourceContext);
}
