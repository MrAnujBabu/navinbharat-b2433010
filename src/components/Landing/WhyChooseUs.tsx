import { memo } from "react";

const points = [
  { n: "01", t: "Concept-first teaching", d: "Har topic pehle concept, phir application — ratta nahi, samajh." },
  { n: "02", t: "NCERT-first approach", d: "Biology line-by-line, Physics/Chemistry concept + numericals — NEET jo poochta hai wahi." },
  { n: "03", t: "DPP + test series", d: "Har chapter par DPP, weekly full-length NEET pattern mock aur rank analysis." },
  { n: "04", t: "PYQ + doubt support", d: "10 saal ke NEET PYQ solved, plus live doubt session aur 24×7 Ask Doubt AI." },
];

const WhyChooseUs = memo(() => (
  <section className="py-20 md:py-28 bg-background border-b border-border/60">
    <div className="container mx-auto max-w-7xl px-6 lg:px-10">
      <div className="max-w-4xl space-y-10">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-accent font-medium mb-3">Our method</p>
            <h2
              className="font-serif text-4xl md:text-5xl text-foreground leading-[1.1]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              NEET crack karne ka seedha raasta.
            </h2>
            <p className="text-lg text-muted-foreground mt-5 leading-relaxed">
              NCERT depth + exam-level practice + Hindi explanation. Roz ka target, weekly test
              — aur rank khud sudharti hai.
            </p>
          </div>

          <ul className="divide-y divide-border/60 border-y border-border/60">
            {points.map((p) => (
              <li key={p.n} className="py-6 grid grid-cols-[auto_1fr] gap-6 items-baseline">
                <span className="font-serif text-2xl text-accent tabular-nums" style={{ fontFamily: "var(--font-serif)" }}>
                  {p.n}
                </span>
                <div>
                  <h3 className="font-medium text-lg text-foreground mb-1">{p.t}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{p.d}</p>
                </div>
              </li>
            ))}
          </ul>
      </div>
    </div>
  </section>
));

WhyChooseUs.displayName = "WhyChooseUs";
export default WhyChooseUs;
