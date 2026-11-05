import { createContext } from "react";

export type InstallResult = "accepted" | "dismissed" | "unavailable";

export interface PwaInstallContextValue {
  isInstalled: boolean;
  installApp: () => Promise<InstallResult>;
}

export const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);