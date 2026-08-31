import { memo } from "react";
import { Button } from "../ui/button";
import { ArrowRight, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { tapHaptic, selectionHaptic } from "@/lib/native/haptics";

export interface HeroData {
  title: string;
  subtitle: string;
  cta_text: string;
}

export interface HeroStat {
  stat_key: string;
  stat_value: string;
}

interface HeroProps {
  data: HeroData | null;
  stats?: HeroStat[];
}

const DEFAULT_TITLE = "NEET ka pura syllabus. Ek disciplined system.";
const DEFAULT_SUBTITLE =
  "NCERT line-by-line lessons, daily DPP, 10 saal ke PYQ aur weekly full-length tests — ek structured batch mein.";

const pillars = [
  "NCERT line-by-line",
  "Daily DPP",
  "10 saal ke PYQ",
  "Weekly full-length test",
];

const batchTiles = [
  {
    badge: "11",
    title: "NEET Class 11",
    body: "Neev mazboot — Physics, Chemistry, Biology ka NCERT foundation with chapter-wise DPP.",
    meta: "12 months · PCB",
    to: "/neet-class-11",
  },
  {
    badge: "12",
    title: "NEET Class 12",
    body: "Board + NEET ek saath. Full syllabus, PYQ marathon aur weekly mock test.",
    meta: "12 months · PCB",
    to: "/neet-class-12",
  },
  {
    badge: "DR",
    title: "Dropper Batch",
    body: "Class 11 + 12 ka full revision, rank-focused test series aur daily doubt support.",
    meta: "10 months · PCB",
    to: "/signup",
  },
];

const Hero = memo(({ data, stats = [] }: HeroProps) => {
  const statFor = (key: string, fallback: string) =>
    stats.find((s) => s.stat_key === key)?.stat_value || fallback;

  const proof = [
    { value: statFor("students", "10k+"), label: "Students" },
    { value: statFor("courses", "20+"), label: "Batches" },
    { value: statFor("teachers", "10+"), label: "Faculty" },
  ];

  return (
    <section className="relative bg-background">
      <div className="container mx-auto max-w-7xl px-5 md:px-6 lg:px-10 pt-8 pb-12 md:pt-14 md:pb-20">
        {/* ── Focused hero column ───────────────────────────────── */}
        <div className="max-w-3xl">
          <p className="eyebrow inline-flex items-center gap-2 text-accent text-xs font-semibold uppercase tracking-[0.18em]">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            NEET batches live
          </p>

          <h1
            className="mt-5 font-serif text-[2.1rem] leading-[1.06] sm:text-5xl md:text-6xl text-foreground"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {data?.title || DEFAULT_TITLE}
          </h1>

          <p className="mt-5 text-base md:text-lg text-muted-foreground leading-relaxed max-w-xl">
            {data?.subtitle || DEFAULT_SUBTITLE}
          </p>

          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <Link to="/signup" onClick={() => { void tapHaptic("light"); }} className="sm:w-auto">
              <Button
                size="lg"
                className="h-12 w-full sm:w-auto px-7 rounded-xl text-base font-semibold gap-2 active:scale-[0.97] transition-transform duration-150 ease-out"
              >
                {data?.cta_text || "Free lesson dekhein"}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </Link>
            <Link to="/courses" onClick={() => { void selectionHaptic(); }} className="sm:w-auto">
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-full sm:w-auto px-7 rounded-xl text-base font-semibold active:scale-[0.97] transition-transform duration-150 ease-out"
              >
                Batches dekhein
              </Button>
            </Link>
          </div>

          {/* Pillars */}
          <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2.5">
            {pillars.map((p) => (
              <li key={p} className="inline-flex items-center gap-2 text-sm text-foreground/80">
                <CheckCircle2 className="h-4 w-4 text-accent" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>

        {/* ── Proof row ─────────────────────────────────────────── */}
        <dl className="mt-10 md:mt-14 grid grid-cols-3 divide-x divide-border border-y border-border">
          {proof.map((p) => (
            <div key={p.label} className="py-5 px-3 first:pl-0 text-center sm:text-left">
              <dt className="sr-only">{p.label}</dt>
              <dd
                className="font-serif text-2xl md:text-3xl text-foreground tabular-nums"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {p.value}
              </dd>
              <span className="mt-1 block text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {p.label}
              </span>
            </div>
          ))}
        </dl>

        {/* ── Batch rail ────────────────────────────────────────── */}
        <div className="mt-10 md:mt-14">
          <div className="flex items-baseline justify-between gap-4 mb-5">
            <h2 className="font-serif text-xl md:text-2xl text-foreground" style={{ fontFamily: "var(--font-serif)" }}>
              Apna batch chunein
            </h2>
            <Link
              to="/courses"
              onClick={() => { void selectionHaptic(); }}
              className="text-sm font-medium text-accent inline-flex items-center gap-1 min-h-[44px]"
            >
              Sabhi batches <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          <div className="-mx-5 px-5 md:mx-0 md:px-0 flex md:grid md:grid-cols-3 gap-4 overflow-x-auto md:overflow-visible snap-x snap-mandatory scrollbar-none pb-1">
            {batchTiles.map((t) => (
              <Link
                key={t.title}
                to={t.to}
                onClick={() => { void selectionHaptic(); }}
                className="group snap-start shrink-0 w-[78%] sm:w-[52%] md:w-auto rounded-2xl border border-border bg-card p-6 flex flex-col hover:border-accent transition-colors duration-200"
              >
                <span className="h-10 w-10 rounded-lg bg-accent/10 text-accent font-serif text-base flex items-center justify-center mb-4" style={{ fontFamily: "var(--font-serif)" }}>
                  {t.badge}
                </span>
                <h3 className="font-medium text-lg text-foreground mb-1.5">{t.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">{t.body}</p>
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-4">{t.meta}</span>
                <span className="mt-auto text-sm font-semibold text-accent inline-flex items-center gap-1.5 group-hover:gap-2.5 transition-all duration-200">
                  Batch dekhein <ArrowRight className="h-4 w-4" aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
});

Hero.displayName = "Hero";
export default Hero;
