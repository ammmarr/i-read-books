import { useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate, useOutlet } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  BookA,
  BookOpen,
  ChartColumn,
  Ellipsis,
  Globe,
  Flame,
  Highlighter,
  ListOrdered,
  Moon,
  PanelLeft,
  Plus,
  Settings,
  Sun,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { dailyTotals, streaks } from "../lib/stats";
import { webSessions } from "../lib/web";
import { setTheme, useIsDark } from "../lib/theme";
import { useImporter } from "./Importer";
import { SyncIndicator } from "./AccountSync";
import { InstallButton } from "./InstallButton";
import { UpdateButton } from "./UpdateButton";
import { Button, IconButton } from "./ui/Button";
import { Sheet } from "./ui/Sheet";
import { BookCover } from "./BookCover";
import { bookProgress } from "../db/books";


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
    // Any reading keeps the streak going — books or Substack.
    async () => streaks(dailyTotals([...(await db.sessions.toArray()), ...webSessions(await db.webReads.toArray())])),
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

type NavItem = { to: string; label: string; short?: string; icon: typeof BookOpen; count?: (c: Counts) => number };
type Counts = { books: number; list: number; highlights: number; words: number };

/** The sidebar's places, by what you do with them. */
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Read",
    items: [
      { to: "/?view=books", label: "Library", icon: BookOpen, count: (c) => c.books },
      { to: "/list", label: "Reading list", short: "List", icon: ListOrdered, count: (c) => c.list },
      { to: "/?view=web", label: "Web", icon: Globe },
    ],
  },
  {
    label: "Keep",
    items: [
      { to: "/highlights", label: "Highlights", icon: Highlighter, count: (c) => c.highlights },
      { to: "/words", label: "Words", icon: BookA, count: (c) => c.words },
    ],
  },
  { label: "Look back", items: [{ to: "/stats", label: "Insights", icon: ChartColumn }] },
];

function isActive(to: string, section: string, search: string) {
  const path = to.split("?")[0];
  if (path === "/") {
    if (section !== "/" && section !== "/book") return false;
    const web = new URLSearchParams(search).get("view") === "web";
    return to.includes("view=web") ? web : !web;
  }
  return section === path;
}

function useCounts(): Counts {
  return (
    useLiveQuery(async () => {
      const books = await db.books.toArray();
      const web = await db.webAnnotations.toArray();
      const words = new Set((await db.lookups.toArray()).map((l) => l.word.toLowerCase())).size;
      return {
        books: books.length,
        list: books.filter((b) => b.status === "reading" || b.status === "queued").length,
        highlights: (await db.highlights.count()) + web.filter((a) => a.kind === "highlight").length,
        words,
      };
    }, []) ?? { books: 0, list: 0, highlights: 0, words: 0 }
  );
}

const MINI_KEY = "irb-sidebar-mini";
function loadMini() {
  try {
    const v = localStorage.getItem(MINI_KEY);
    if (v != null) return v === "1";
  } catch {
    /* private window */
  }
  // On a small tablet the sidebar starts folded, so the page keeps its room.
  return typeof window !== "undefined" && window.innerWidth < 1100;
}

export function AppShell() {
  const location = useLocation();
  const { pick, busy } = useImporter();
  const section = "/" + (location.pathname.split("/")[1] ?? "");

  return (
    <div className="flex min-h-full">
      <Sidebar section={section} search={location.search} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top sticky top-0 z-40 overflow-x-clip border-b border-hairline bg-canvas/85 backdrop-blur-md md:hidden">
          <div className="flex h-14 items-center gap-2 px-4">
            <span className="flex items-center gap-2 text-label-sm text-ink">
              <BookOpen className="size-[18px]" /> I read
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <UpdateButton />
              <InstallButton />
              <StreakChip />
              <SyncIndicator />
              <ThemeToggle />
              <IconButton label="Add book" variant="default" size="icon-sm" onClick={pick} disabled={busy}>
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
              animate={{ opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            >
              <FrozenOutlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <MobileTabs section={section} search={location.search} />
    </div>
  );
}

function Sidebar({ section, search }: { section: string; search: string }) {
  const { pick, busy } = useImporter();
  const counts = useCounts();
  const [mini, setMiniState] = useState(loadMini);
  const setMini = (v: boolean) => {
    setMiniState(v);
    try {
      localStorage.setItem(MINI_KEY, v ? "1" : "0");
    } catch {
      /* private window */
    }
  };
  const link = (n: NavItem) => {
    const active = isActive(n.to, section, search);
    const Icon = n.icon;
    const c = n.count?.(counts);
    return (
      <NavLink
        key={n.to}
        to={n.to}
        title={mini ? n.label : undefined}
        className={`relative flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-label-sm transition-colors ${active ? "text-ink" : "text-body hover:bg-hairline-soft hover:text-ink"} ${mini ? "justify-center px-0" : ""}`}
      >
        {active && (
          <motion.span
            layoutId="side-pill"
            className="absolute inset-0 -z-10 rounded-sm border border-hairline bg-canvas-elevated"
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
          />
        )}
        <Icon className="size-[17px] shrink-0" strokeWidth={active ? 2.1 : 1.8} />
        {!mini && <span className="truncate">{n.label}</span>}
        {!mini && !!c && <span className="ml-auto text-[11px] tabular text-faint">{c}</span>}
      </NavLink>
    );
  };
  return (
    <aside
      className={`safe-top sticky top-0 z-40 hidden h-dvh shrink-0 flex-col border-r border-hairline bg-canvas px-2.5 pb-3 pt-4 transition-[width] duration-300 ease-[cubic-bezier(.2,0,0,1)] md:flex ${mini ? "w-[60px]" : "w-[232px]"}`}
    >
      <div className={`mb-3 flex items-center ${mini ? "flex-col gap-2" : "justify-between px-1.5"}`}>
        <NavLink to="/?view=books" className="flex items-center gap-2 text-[14px] font-semibold text-ink" title="I read">
          <BookOpen className="size-[19px]" />
          {!mini && <span>I read</span>}
        </NavLink>
        <IconButton label={mini ? "Open the sidebar" : "Fold the sidebar"} size="icon-sm" onClick={() => setMini(!mini)}>
          <PanelLeft className="size-4" />
        </IconButton>
      </div>
      <Button onClick={pick} disabled={busy} variant="outline" size="sm" className={`mb-2 ${mini ? "w-full justify-center px-0" : "justify-start"}`} title={mini ? "Add book" : undefined}>
        <Plus className="size-4" />
        {!mini && "Add book"}
      </Button>
      <nav className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        {GROUPS.map((g) => (
          <div key={g.label} className="mt-2">
            {mini ? <div className="mx-3 my-2 h-px bg-hairline" /> : <div className="px-2.5 pb-1 pt-2.5 text-[11px] text-faint">{g.label}</div>}
            <div className="flex flex-col gap-0.5">{g.items.map(link)}</div>
          </div>
        ))}
      </nav>
      {!mini && <ReadingNow />}
      <div className={`mt-2 flex items-center gap-1 ${mini ? "flex-col" : "px-1"}`}>
        <StreakChip />
        <div className={mini ? "contents" : "ml-auto flex items-center gap-0.5"}>
          <UpdateButton />
          <InstallButton />
          <SyncIndicator />
          <ThemeToggle />
        </div>
      </div>
      <div className="mt-1 flex flex-col gap-0.5">{link({ to: "/settings", label: "Settings", icon: Settings })}</div>
    </aside>
  );
}

/** The book you're reading, at the foot of the sidebar: one click back into it. */
function ReadingNow() {
  const navigate = useNavigate();
  const book = useLiveQuery(async () => {
    const reading = (await db.books.where("status").equals("reading").toArray()).filter((b) => b.pageCount > 0);
    return reading.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0] ?? null;
  }, []);
  if (!book) return null;
  const p = bookProgress(book);
  return (
    <button
      onClick={() => navigate(`/read/${book.id}`)}
      className="mt-2 flex items-center gap-2.5 rounded-md border border-hairline bg-canvas-elevated p-2.5 text-left transition-colors hover:border-faint/40"
      title={`Continue ${book.title}`}
    >
      <div className="w-7 shrink-0 overflow-hidden rounded-[2px] shadow-cover">
        <BookCover book={book} rounded="rounded-[2px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-faint">Reading now</div>
        <div className="truncate text-label-sm text-ink">{book.title}</div>
        <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-hairline">
          <i className="block h-full rounded-full bg-ink" style={{ width: `${Math.max(2, p * 100)}%` }} />
        </div>
      </div>
    </button>
  );
}

const TABS: NavItem[] = [
  { to: "/?view=books", label: "Library", icon: BookOpen },
  { to: "/list", label: "List", icon: ListOrdered },
  { to: "/highlights", label: "Highlights", icon: Highlighter },
  { to: "/stats", label: "Insights", icon: ChartColumn },
];
const MORE: NavItem[] = [
  { to: "/?view=web", label: "Web", icon: Globe },
  { to: "/words", label: "Words", icon: BookA },
  { to: "/settings", label: "Settings", icon: Settings },
];

function MobileTabs({ section, search }: { section: string; search: string }) {
  const [more, setMore] = useState(false);
  const navigate = useNavigate();
  const moreActive = MORE.some((n) => isActive(n.to, section, search));
  const tab = (n: NavItem, active: boolean, onClick?: () => void) => {
    const Icon = n.icon;
    const inner = (
      <>
        {active && (
          <motion.span layoutId="tab-pill" className="absolute top-2 h-8 w-14 rounded-full bg-hairline-soft" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
        )}
        <motion.span whileTap={{ scale: 0.85 }} className="relative grid h-8 w-full max-w-14 place-items-center">
          <Icon className={`size-5 transition-colors ${active ? "text-ink" : "text-mute"}`} strokeWidth={active ? 2.2 : 1.8} />
        </motion.span>
        <span className={`relative text-[11px] font-medium transition-colors ${active ? "text-ink" : "text-mute"}`}>{n.label}</span>
      </>
    );
    const cls = "relative flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1";
    return onClick ? (
      <button key={n.label} onClick={onClick} className={cls}>{inner}</button>
    ) : (
      <NavLink key={n.to} to={n.to} className={cls}>{inner}</NavLink>
    );
  };
  return (
    <>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-canvas/90 backdrop-blur-md md:hidden">
        <div className="mx-auto flex max-w-[560px]">
          {TABS.map((n) => tab(n, isActive(n.to, section, search)))}
          {tab({ to: "#more", label: "More", icon: Ellipsis }, moreActive, () => setMore(true))}
        </div>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)}>
        <div className="flex flex-col gap-1 pb-2">
          {MORE.map((n) => {
            const Icon = n.icon;
            const active = isActive(n.to, section, search);
            return (
              <button
                key={n.to}
                onClick={() => {
                  setMore(false);
                  navigate(n.to);
                }}
                className={`flex h-12 items-center gap-3 rounded-md px-3 text-left text-body-md ${active ? "bg-hairline-soft text-ink" : "text-body"}`}
              >
                <Icon className="size-5" /> {n.label}
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
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
      className={`mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 md:py-10 ${className} touch:max-w-none md:touch:px-8`}
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
