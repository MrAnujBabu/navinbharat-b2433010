// Exam track config — drives batch cards on landing + exam-specific SEO pages.
// Static for now; move to Supabase when real batch data is ready.

export type ExamTrackSlug = "neet-class-11" | "neet-class-12" | "neet-dropper";

export interface ExamTrack {
  slug: ExamTrackSlug;
  route?: string; // dedicated landing route (SEO)
  badge: string;
  title: string;
  faculty: string;
  language: string;
  duration: string;
  startDate: string;
  seats: string | null;
  priceMrp?: number;
  priceEffective?: number;
  short: string;
  hero: {
    h1: string;
    subtitle: string;
    metaTitle: string;
    metaDescription: string;
  };
  syllabus: { chapter: string; topics: string[] }[];
  includes: string[];
  faqs: { q: string; a: string }[];
}

export const examTracks: ExamTrack[] = [
  {
    slug: "neet-class-11",
    route: "/neet-class-11",
    badge: "NEET 11th",
    title: "NEET Foundation — Class 11 (PCB)",
    faculty: "Naveen Bharat faculty",
    language: "Hindi medium friendly",
    duration: "12 months · 400+ lessons",
    startDate: "Naya batch: 5 Sep 2026",
    seats: "Limited seats",
    priceMrp: 4999,
    priceEffective: 1499,
    short: "Class 11 Physics, Chemistry aur Biology — NCERT line-by-line plus NEET-level question practice.",
    hero: {
      h1: "NEET Class 11 — Physics, Chemistry & Biology in Hindi",
      subtitle:
        "Naveen Bharat ke saath NEET ki neev — Class 11 NCERT ka har chapter, concept videos, DPP aur chapter-wise test. Hindi medium students ke liye banaya gaya.",
      metaTitle: "NEET Class 11 Course (PCB) in Hindi | Naveen Bharat",
      metaDescription:
        "NEET Class 11 ki taiyari — Physics, Chemistry, Biology ke NCERT-based video lessons, DPP, PYQ aur chapter tests. Free demo aaj shuru karein.",
    },
    syllabus: [
      { chapter: "Physics", topics: ["Units & Measurement", "Motion in a Straight Line", "Laws of Motion", "Work Energy Power", "Thermodynamics"] },
      { chapter: "Chemistry", topics: ["Some Basic Concepts", "Structure of Atom", "Chemical Bonding", "Equilibrium", "Hydrocarbons"] },
      { chapter: "Biology", topics: ["Living World & Classification", "Plant Physiology", "Cell Structure", "Human Physiology", "Biomolecules"] },
    ],
    includes: [
      "400+ recorded lessons in Hindi",
      "NCERT-based PDF notes aur diagrams",
      "Daily Practice Problems (DPP) har chapter par",
      "Chapter-wise aur full-syllabus NEET pattern tests",
      "Live doubt-clearing session har Sunday",
    ],
    faqs: [
      { q: "Ye batch kiske liye hai?", a: "Class 11 ke students jo NEET target kar rahe hain — Hindi medium ke liye specially designed." },
      { q: "Kya NCERT line-by-line cover hota hai?", a: "Haan, Biology poora NCERT line-by-line aur Physics/Chemistry concept plus numericals ke saath." },
      { q: "DPP aur test kitne milte hain?", a: "Har chapter par DPP aur chapter test, plus monthly full-syllabus NEET pattern mock." },
      { q: "Doubt kaise clear hote hain?", a: "Har Sunday live doubt session aur app ke andar Ask Doubt AI 24×7 available hai." },
      { q: "Free demo milta hai?", a: "Haan — signup ke baad har subject ka first chapter completely free hai." },
    ],
  },
  {
    slug: "neet-class-12",
    route: "/neet-class-12",
    badge: "NEET 12th",
    title: "NEET Target — Class 12 (PCB)",
    faculty: "Naveen Bharat faculty",
    language: "Hindi + English",
    duration: "12 months · 420+ lessons",
    startDate: "Naya batch: 12 Sep 2026",
    seats: "60 seats left",
    priceMrp: 5999,
    priceEffective: 1799,
    short: "Class 12 PCB board + NEET dono ek saath — NCERT, PYQ aur weekly mock test series.",
    hero: {
      h1: "NEET Class 12 — Board + NEET Ek Saath",
      subtitle:
        "Class 12 Physics, Chemistry aur Biology ka poora syllabus NEET pattern ke saath. NCERT coverage, 10 saal ke PYQ aur weekly mock test.",
      metaTitle: "NEET Class 12 Course (PCB) + Board Prep | Naveen Bharat",
      metaDescription:
        "NEET Class 12 ki taiyari Hindi mein — NCERT-based lessons, previous year questions, weekly mock tests aur doubt support. Board aur NEET dono cover.",
    },
    syllabus: [
      { chapter: "Physics", topics: ["Electrostatics", "Current Electricity", "Magnetism", "Optics", "Modern Physics"] },
      { chapter: "Chemistry", topics: ["Solutions", "Electrochemistry", "Chemical Kinetics", "Coordination Compounds", "Biomolecules"] },
      { chapter: "Biology", topics: ["Reproduction", "Genetics & Evolution", "Human Health & Disease", "Biotechnology", "Ecology"] },
    ],
    includes: [
      "420+ lessons — full Class 12 PCB syllabus",
      "Last 10 years NEET PYQ solved aur explained",
      "Weekly full-length NEET mock test",
      "NCERT highlight notes + revision sheets",
      "Live doubt session har Saturday",
    ],
    faqs: [
      { q: "Kya board exam bhi cover hota hai?", a: "Haan — NCERT coverage board ke liye kaafi hai, upar se NEET-level questions milte hain." },
      { q: "PYQ ka solution milta hai?", a: "Har PYQ ka video plus written solution included hai." },
      { q: "Mock test real pattern par hain?", a: "Haan — 720 marks, NEET marking scheme aur time limit exam jaisa hi." },
      { q: "Language kya hai?", a: "Explanation Hindi mein, technical terms English mein — bilingual approach." },
      { q: "Free demo kaise le?", a: "Signup karke har subject ka first chapter free access kar sakte ho." },
    ],
  },
  {
    slug: "neet-dropper",
    route: "/neet-dropper",
    badge: "Dropper",
    title: "NEET Dropper Batch — Full Revision",
    faculty: "Naveen Bharat faculty",
    language: "Hindi + English",
    duration: "9 months · 500+ lessons",
    startDate: "Naya batch: 20 Sep 2026",
    seats: "Limited seats",
    priceMrp: 6999,
    priceEffective: 1999,
    short: "Class 11 + 12 ka complete revision, PYQ marathon aur test series — repeaters ke liye.",
    hero: {
      h1: "NEET Dropper Batch — Class 11 + 12 Complete Revision",
      subtitle:
        "Repeaters ke liye focused batch — dono saal ka syllabus fast-track revision, 10 saal ke PYQ marathon aur har hafte full-length test.",
      metaTitle: "NEET Dropper Batch (Repeater) in Hindi | Naveen Bharat",
      metaDescription:
        "NEET dropper batch — Class 11 aur 12 ka full revision, PYQ marathon, weekly full-length mock test aur daily doubt support. Hindi medium friendly.",
    },
    syllabus: [
      { chapter: "Physics Revision", topics: ["Mechanics", "Electrodynamics", "Optics & Modern", "Numerical marathon"] },
      { chapter: "Chemistry Revision", topics: ["Physical", "Inorganic (NCERT-focused)", "Organic mechanisms", "PYQ drill"] },
      { chapter: "Biology Revision", topics: ["NCERT line-by-line", "Diagram practice", "Genetics numericals", "Ecology & Human Physiology"] },
      { chapter: "Test Series", topics: ["Weekly full-length", "Subject-wise", "Rank analysis"] },
    ],
    includes: [
      "500+ revision lessons across PCB",
      "10 years NEET PYQ marathon with solutions",
      "Weekly full-length test + rank analysis",
      "Short revision notes aur formula sheets",
      "Daily doubt support via app",
    ],
    faqs: [
      { q: "Ye batch kiske liye hai?", a: "Un students ke liye jo ek attempt de chuke hain aur agla NEET target kar rahe hain." },
      { q: "Kya poora syllabus dobara padhaya jata hai?", a: "Haan — Class 11 aur 12 dono fast-track revision mode mein cover hote hain." },
      { q: "Test series alag se leni padegi?", a: "Nahi, weekly full-length test series batch ke andar included hai." },
      { q: "Rank analysis milta hai?", a: "Har test ke baad percentile, subject-wise weak area aur rank report milti hai." },
      { q: "Free demo?", a: "Haan — Biology revision ka first module aur ek PYQ marathon session free hai." },
    ],
  },
];

export const examTrackBySlug = (slug: string): ExamTrack | undefined =>
  examTracks.find((t) => t.slug === slug);

export const examTrackByRoute = (route: string): ExamTrack | undefined =>
  examTracks.find((t) => t.route === route);
