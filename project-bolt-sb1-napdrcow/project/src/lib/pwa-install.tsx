import { useEffect, useState, type ReactNode } from "react";
import { PwaInstallContext, type InstallResult } from "@/lib/pwa-install-context";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(isStandalone);

  useEffect(() => {
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setPromptEvent(null);
    };
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const updateDisplayMode = () => setIsInstalled(isStandalone());

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    displayMode.addEventListener("change", updateDisplayMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
      displayMode.removeEventListener("change", updateDisplayMode);
    };
  }, []);

  const installApp = async (): Promise<InstallResult> => {
    if (!promptEvent) return "unavailable";
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    if (choice.outcome === "accepted") setIsInstalled(true);
    return choice.outcome;
  };

  return <PwaInstallContext.Provider value={{ isInstalled, installApp }}>{children}</PwaInstallContext.Provider>;
}