"use client";

import Link from "next/link";
import { Power, Settings } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LanguageToggle } from "@/components/language-toggle";
import { Button } from "@/components/ui/button";
import type { SessionUser, SystemLicenseState } from "@/lib/api";
import { getCameraStatus, getCurrentSession, listCameraDevices } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n";
import {
  clearSession,
  getAccessToken,
  saveSession,
} from "@/lib/session";
import { getDesktopBridge } from "@/lib/desktop";
import { useLicenseWatchdog } from "@/lib/use-license-watchdog";

type AppShellProps = {
  children: ReactNode;
  titleKey?: TranslationKey;
  descriptionKey?: TranslationKey;
};

const menuItems = [
  { labelKey: "nav.dashboard", href: "/dashboard", permission: null },
  { labelKey: "nav.line", href: "/dashboard/line", permission: null },
  { labelKey: "nav.users", href: "/dashboard/users", permission: "user.manage" },
  { labelKey: "nav.roles", href: "/dashboard/roles", permission: "role.manage" },
  {
    labelKey: "nav.products",
    href: "/dashboard/products",
    permission: "product.manage",
  },
  { labelKey: "nav.camera", href: "/dashboard/camera", permission: "camera.manage" },
  {
    labelKey: "nav.cameraDebug",
    href: "/dashboard/camera-debug",
    permission: "camera.manage",
  },
  { labelKey: "nav.roi", href: "/dashboard/roi", permission: "roi.edit" },
  { labelKey: "nav.history", href: "/dashboard/history", permission: "history.view" },
  { labelKey: "nav.reports", href: "/dashboard/reports", permission: "report.view" },
  { labelKey: "nav.settings", href: "/dashboard/settings", permission: "system.shutdown" },
] satisfies Array<{
  labelKey: TranslationKey;
  href: string;
  permission: string | null;
}>;

export function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const handleLicenseLost = useCallback(
    (license: SystemLicenseState) => {
      clearSession();
      toast.error(license.message || t("session.licenseLost"));
      router.replace("/login");
    },
    [router, t],
  );
  const { license } = useLicenseWatchdog({
    enabled: Boolean(user),
    onLicenseLost: handleLicenseLost,
  });

  useEffect(() => {
    const token = getAccessToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    getCurrentSession(token)
      .then((response) => {
        const nextUser = response.data.user;
        saveSession(token, nextUser);
        setUser(nextUser);

        if (shouldPrimeCameraRuntime(nextUser)) {
          void primeCameraRuntime(token);
        }
      })
      .catch(() => {
        clearSession();
        router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [router]);

  function handleLogout() {
    clearSession();
    router.replace("/login");
  }

  async function handleExitApp() {
    const bridge = getDesktopBridge();

    if (!bridge) {
      toast.warning(t("settings.desktopOnly"));
      return;
    }

    toast.loading(t("settings.exiting"));
    await bridge.exitApp();
  }

  if (loading && !user) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-100">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const visibleMenuItems = menuItems.filter(
    (item) =>
      item.permission === null ||
      user.isDev ||
      user.permissions.includes(item.permission),
  );
  const canManageDesktopSettings =
    user.isDev || user.permissions.includes("system.shutdown");
  const usesSidebar = user.role === "dev" || user.role === "admin";
  const navLinks = (
    <nav
      className={
        usesSidebar
          ? "space-y-1"
          : "flex min-w-max items-center gap-2 lg:min-w-0 lg:flex-wrap"
      }
    >
      {visibleMenuItems.map((item) => {
        const active = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "flex h-10 items-center border px-3 text-left text-sm font-medium transition",
              usesSidebar ? "w-full" : "w-auto",
              active
                ? "border-cyan-200 bg-cyan-50 text-cyan-900"
                : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50",
            ].join(" ")}
          >
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <main className="flex h-[100dvh] overflow-hidden bg-slate-100 text-slate-950">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex min-h-16 shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:px-6">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
              {t("app.brand")}
            </div>
            <div className="truncate text-lg font-semibold">{t("app.line")}</div>
          </div>
          {usesSidebar ? null : (
            <div className="min-w-0 flex-1 overflow-x-auto">
              <div className="flex min-w-max items-center gap-2 px-0 sm:justify-center">
                {navLinks}
              </div>
            </div>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-3 text-sm sm:justify-end lg:gap-4">
            <LanguageToggle />
            <div
              className={[
                "flex h-9 items-center gap-2 border px-3 text-xs font-semibold",
                license?.licensed === true && license.donglePresent === true
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-slate-50 text-slate-600",
              ].join(" ")}
            >
              <span
                className={[
                  "h-2.5 w-2.5 rounded-full",
                  license?.licensed === true && license.donglePresent === true
                    ? "bg-emerald-500"
                    : "bg-slate-300",
                ].join(" ")}
              />
              {license?.licensed === true && license.donglePresent === true
                ? t("dashboard.donglePresent")
                : t("dashboard.pending")}
            </div>
            <div className="min-w-0 text-left sm:text-right">
              <div className="font-semibold">{user.fullName}</div>
              <div className="text-slate-500">
                {user.role}
                {user.isDev ? ` / ${t("session.hiddenDev")}` : ""}
              </div>
            </div>
            {canManageDesktopSettings ? (
              <Button
                asChild
                variant="outline"
                size="icon"
                title={t("nav.settings")}
              >
                <Link href="/dashboard/settings">
                  <Settings className="h-4 w-4" />
                </Link>
              </Button>
            ) : null}
            <Button
              onClick={handleExitApp}
              variant="outline"
              size="icon"
              title={t("settings.exitApp")}
            >
              <Power className="h-4 w-4" />
            </Button>
            <Button
              onClick={handleLogout}
              variant="outline"
              size="sm"
            >
              {t("session.logout")}
            </Button>
          </div>
        </header>

        {usesSidebar ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden lg:grid lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
            <div className="shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
              <nav className="flex min-w-max items-center gap-2">
                {visibleMenuItems.map((item) => {
                  const active = pathname === item.href;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={[
                        "flex h-10 items-center border px-3 text-left text-sm font-medium transition",
                        active
                          ? "border-cyan-200 bg-cyan-50 text-cyan-900"
                          : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      {t(item.labelKey)}
                    </Link>
                  );
                })}
              </nav>
            </div>

            <aside className="hidden min-h-0 overflow-y-auto border-r border-slate-200 bg-white p-4 lg:block">
              {navLinks}
            </aside>

            <div className="flex min-h-0 min-w-0 flex-col">
              <section className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-5 lg:p-5 xl:p-6">
                {children}
              </section>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <section className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-5 lg:p-6">
              {children}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function shouldPrimeCameraRuntime(user: SessionUser) {
  return (
    user.isDev ||
    user.permissions.includes("camera.manage") ||
    user.permissions.includes("inspection.start")
  );
}

async function primeCameraRuntime(accessToken: string) {
  await Promise.allSettled([
    getCameraStatus(accessToken),
    listCameraDevices(accessToken),
  ]);
}
