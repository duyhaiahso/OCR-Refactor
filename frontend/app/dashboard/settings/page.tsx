"use client";

import { AppShell } from "@/components/app-shell";
import { DesktopSettingsPanel } from "@/components/settings/desktop-settings-panel";

export default function SettingsPage() {
  return (
    <AppShell
      titleKey="settings.title"
      descriptionKey="settings.description"
    >
      <DesktopSettingsPanel />
    </AppShell>
  );
}
