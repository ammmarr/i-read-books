import { useState, type ReactNode } from "react";
import { NavLink, useLocation, useOutlet } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  BookOpen,
  ChartColumn,
  Flame,
  ListOrdered,
  Moon,
  Plus,
  Settings,
  Sun,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { dailyTotals, streaks } from "../lib/stats";
import { setTheme, useIsDark } from "../lib/theme";
import { useImporter } from "./Importer";
import { SyncIndicator } from "./AccountSync";
import { InstallButton } from "./InstallButton";
import { Button, IconButton } from "./ui/Button";

const NAV = [
  { to: "/", label: "Library", icon: BookOpen },
  { to: "/list", label: "Reading list", short: "List", icon: ListOrdered },
  { to: "/stats", label: "Insights", icon: ChartColumn },
  { to: "/settings", label: "Settings", icon: Settings },
];

/** Freezes the outlet so the exiting page keeps rendering its own content during its exit animation. */
function FrozenOutlet() {
  const o = useOutlet();
  const [frozen] = useState(o);
  return frozen;
}

export function ThemeToggle() {
  const dark = useIsDark();
  return (
    <IconButton
      label={dark ? "Light mode" : "Dark mode"}
      tipBelow
      onClick={(e) =>
        setTheme(dark ? "light" : "dark", { x: e.clientX, y: e.clientY })
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={dark ? "moon" : "sun"}
          initial={{ rotate: -90, scale: 0.5, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: 0.5, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="grid place-items-center"
        >
          {dark ? (
            <Moon className="size-[18px]" />
          ) : (
            <Sun className="size-[18px]" />
          )}
        </motion.span>
      </AnimatePresence>
    </IconButton>
  );
}

function StreakChip() {
  const s = useLiveQuery(
    async () => streaks(dailyTotals(await db.sessions.toArray())),
    [],
  );
  if (!s || s.current === 0) return null;
  return (
    <NavLink
      to="/stats"
      title={
        s.readToday
          ? `${s.current}-day streak`
          : `${s.current}-day streak — read today to keep it`
      }
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-hairline bg-canvas-elevated px-2.5 text-label-sm text-ink transition-colors hover:bg-hairline-soft"
    >
      <Flame
        className={`size-4 ${s.readToday ? "fill-warning/30 text-warning" : "text-faint"}`}
      />
      <span className="tabular">{s.current}</span>
    </NavLink>
  );
}

export function AppShell() {
  const location = useLocation();
  const { pick, busy } = useImporter();
  const section = "/" + (location.pathname.split("/")[1] ?? "");

  return (
    <div className="flex min-h-full flex-col">
      <header className="safe-top sticky top-0 z-40 border-b border-hairline bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-2 px-4 md:h-16 md:px-6">
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => {
              const active =
                n.to === "/"
                  ? section === "/" || section === "/book"
                  : section === n.to;
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={`relative rounded-full px-3 py-1.5 text-label-sm transition-colors ${active ? "text-ink" : "text-body hover:text-ink"}`}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 -z-10 rounded-full border border-hairline bg-canvas-elevated"
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 40,
                      }}
                    />
                  )}
                  {n.label}
                </NavLink>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <InstallButton />
            <StreakChip />
            <SyncIndicator />
            <ThemeToggle />
            <Button
              onClick={pick}
              disabled={busy}
              size="sm"
              className="ml-1 hidden sm:inline-flex"
            >
              <Plus className="size-4" />
              Add book
            </Button>
            <IconButton
              label="Add book"
              variant="default"
              size="icon-sm"
              className="sm:hidden"
              onClick={pick}
              disabled={busy}
            >
              <Plus className="size-4" />
            </IconButton>
          </div>
        </div>
      </header>

      <div className="relative flex-1 pb-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+72px)] md:pb-0">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
            }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
          >
            <FrozenOutlet />
          </motion.div>
        </AnimatePresence>
      </div>

      <MobileTabs section={section} />
    </div>
  );
}

function MobileTabs({ section }: { section: string }) {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-canvas/90 backdrop-blur-md md:hidden">
      <div className="mx-auto flex max-w-[560px]">
        {NAV.map((n) => {
          const active =
            n.to === "/"
              ? section === "/" || section === "/book"
              : section === n.to;
          const Icon = n.icon;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              className="relative flex h-16 flex-1 flex-col items-center justify-center gap-1"
            >
              {active && (
                <motion.span
                  layoutId="tab-pill"
                  className="absolute top-2 h-8 w-14 rounded-full bg-hairline-soft"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <motion.span
                whileTap={{ scale: 0.85 }}
                className="relative grid h-8 w-14 place-items-center"
              >
                <Icon
                  className={`size-5 transition-colors ${active ? "text-ink" : "text-mute"}`}
                  strokeWidth={active ? 2.2 : 1.8}
                />
              </motion.span>
              <span
                className={`relative text-[11px] font-medium transition-colors ${active ? "text-ink" : "text-mute"}`}
              >
                {n.short ?? n.label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

export function PageContainer({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={`mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 md:py-10 ${className}`}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 md:mb-8">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2 text-mono-eyebrow text-mute">{eyebrow}</div>
        )}
        <h1 className="text-[26px] font-semibold leading-8 tracking-[-1px] text-ink md:text-heading-lg">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-body-lg text-body">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
