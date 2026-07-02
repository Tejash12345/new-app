import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Sparkles, Swords, RotateCw, CheckCircle2, XCircle, CalendarDays, Timer, Bookmark, GraduationCap, Volume2, Pause, Target } from 'lucide-react'
import { useTable } from '../hooks/db'
import { useAuth } from '../hooks/useAuth'
import { useSpeech } from '../hooks/useSpeech'
import { examStudyPlan, explainQuizQuestion, generateQuiz, teachTopic, type ExamStudyPlan, type QuizQuestion } from '../lib/ai'
import type { Note, QuizResult } from '../lib/types'
import { Button, Empty, GlassCard, Input, Modal, Page, ProgressRing, SectionTitle } from '../components/ui'
import { cn, timeAgo, todayKey } from '../lib/utils'

// ----------------------------------------------------------------------------
// AI Quiz Arena — Leo builds a multiple-choice quiz on any topic (or on one of
// the user's own notes), grades it instantly with explanations, and pays out
// XP. History is saved to `quiz_results` (upgrade-27.sql).
// ----------------------------------------------------------------------------

const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Expert'] as const
const COUNTS = [5, 10, 20, 25, 50, 100] as const

type Phase = 'setup' | 'loading' | 'playing' | 'done'

// how each special question format is described to the AI
const QTYPE_STYLE: Record<string, string> = {
  'Clinical Scenario': 'EVERY question must be a clinical scenario / case-based question: a 2-3 line patient presentation (age, complaint, key vitals or findings) followed by what the nurse should assess, do or expect.',
  'Priority Question': 'EVERY question must be a PRIORITY question asking for the FIRST / BEST / MOST IMPORTANT nursing action, with four plausible actions as options — only one is the correct priority.',
  'Drug Dose & Calculation': 'EVERY question must be a numeric calculation: drug dose, IV drip rate, dilution or unit conversion with realistic clinical values; the explanation must show the working step by step.',
  'Assertion-Reason': 'EVERY question must be in Assertion (A) and Reason (R) format with the standard four options (both true and R explains A / both true but R does not explain A / A true R false / A false R true).',
  'Statement Based': 'EVERY question must present 2-3 numbered statements and ask which is/are correct, in the real exam\'s statement-question style.',
  'Match the Following': 'EVERY question must be a Match List-I with List-II question written out in the question text, with the options giving code combinations.',
  'Numerical Value': 'EVERY question must be numerical-answer style: a computation whose result picks one of four numeric options; the explanation shows the working.',
  'Assertion & Reason': 'EVERY question must be in Assertion (A) and Reason (R) format with the standard four options (both true and R explains A / both true but R does not explain A / A true R false / A false R true).',
  'Case Study': 'EVERY question must be a detailed clinical case study: 3-4 lines of patient history, vitals and relevant findings, then a question on the priority assessment, diagnosis or nursing intervention.',
  'Multiple Correct': 'EVERY question should have more than one correct statement; frame the options so the answer is the choice that lists ALL the correct ones (e.g. "1, 3 and 4"). Keep exactly four options.',
  'Fill in the Blank': 'EVERY question must be a fill-in-the-blank sentence with a key term, value or drug missing, and four options for the blank.',
  'Lab Values': 'EVERY question must be about normal laboratory reference ranges or interpreting an abnormal lab value (CBC, ABG, electrolytes, LFT, KFT, blood sugar); the explanation should state the normal range.',
  'ECG Interpretation': 'EVERY question must DESCRIBE an ECG finding in words (rate, rhythm, PR/QRS, ST changes, characteristic pattern) and ask for the interpretation or the priority nursing action. Do NOT reference an image the student cannot see — describe the tracing fully in text.',
  'X-Ray Interpretation': 'EVERY question must DESCRIBE a chest X-ray / radiograph finding in words and ask for the likely diagnosis or nursing implication. Describe the finding fully in text — never reference an unseen image.',
  'Instrument Identification': 'EVERY question must describe a medical/surgical instrument or equipment by its use and features and ask the student to identify it, or ask about its correct use/care. Describe it in words — never reference an unseen image.',
  'Output Prediction': 'EVERY question must show a short code snippet (in the chosen language) in the question text and ask what it prints/returns or whether it errors; the explanation must trace the code.',
}

// PYQ year filter (shown in Previous-year mode)
const PYQ_YEARS = ['Any', '2026', '2025', '2024', '2023', '2022', '2021', '2020'] as const

// extra "question source" flavours beyond pyq/repeated/fresh — each nudges the
// generator toward a different style without changing the core engine
const SOURCE_STYLE: Record<string, string> = {
  Expected: 'Generate EXPECTED / most-probable questions for the upcoming exam based on trends and current syllabus emphasis.',
  Clinical: 'Generate applied CLINICAL questions — patient scenarios and bedside decision-making rather than pure theory.',
  NCLEX: 'Generate NCLEX-style questions — application/analysis level, prioritization and safe-practice focus.',
  Rapid: 'Generate RAPID-REVISION one-liners — short, high-yield factual questions that can be answered quickly.',
}


// ---- local revision stores (bookmarks + wrong questions), no backend needed ----
type SavedQ = QuizQuestion & { topic: string }
const WRONG_KEY = 'fl:quiz:wrong'
const MARK_KEY = 'fl:quiz:bookmarks'
function loadStore(key: string): SavedQ[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]') as SavedQ[] } catch { return [] }
}
function saveStore(key: string, items: SavedQ[]) {
  try { localStorage.setItem(key, JSON.stringify(items.slice(0, 60))) } catch { /* quota / private mode */ }
}
const qKey = (q: { q: string }) => q.q.slice(0, 80)

// ---- exam categories — real competitive-exam patterns Leo can imitate ----
type ExamSpec = {
  key: string; name: string; emoji: string; tagline: string
  subjects: string[]; style: string
  /** special question formats this exam supports (pills in the UI) */
  qtypes?: string[]
  /** quick topic chips per subject — the Subject → Topic hierarchy */
  topics?: Record<string, string[]>
  /** real exam pace, seconds per question (drives the mock timer) */
  secondsPerQ?: number
  /** short real-pattern label shown under the exam header, e.g. "200 Q · 200 min" */
  pattern?: string
}

/** the mock timer falls back to this when an exam has no secondsPerQ set */
const DEFAULT_SECONDS_PER_Q = 60

// per-exam marking scheme (points per correct, deducted per wrong) — matches
// each exam's real paper; drives the mock marks card + the scoring note.
// Exams not listed (and custom topics) use DEFAULT_MARKING.
const DEFAULT_MARKING = { pos: 1, neg: 1 / 3 }
const MARKING: Record<string, { pos: number; neg: number }> = {
  neet: { pos: 4, neg: 1 },
  jee: { pos: 4, neg: 1 },
  norcet: { pos: 1, neg: 1 / 3 },
  upsc: { pos: 2, neg: 2 / 3 },
  banking: { pos: 1, neg: 0.25 },
  ssc: { pos: 2, neg: 0.5 },
  railways: { pos: 1, neg: 1 / 3 },
  police: { pos: 1, neg: 0.25 },
  gate: { pos: 1, neg: 1 / 3 },
  teaching: { pos: 1, neg: 0 },   // CTET/TET — no negative marking
  aptitude: { pos: 1, neg: 0 },
  coding: { pos: 1, neg: 0 },
  english: { pos: 1, neg: 0 },
  gk: { pos: 1, neg: 0 },
  ca: { pos: 1, neg: 0 },
}
/** pretty fraction glyph for a marking value: 0.33→⅓, 0.25→¼, 0.5→½, 0.67→⅔ */
function fracGlyph(n: number): string {
  if (Number.isInteger(n)) return String(n)
  const map: Record<string, string> = { '0.33': '⅓', '0.25': '¼', '0.50': '½', '0.67': '⅔', '0.75': '¾' }
  return map[n.toFixed(2)] ?? n.toFixed(2)
}

const EXAMS: ExamSpec[] = [
  {
    key: 'neet', name: 'NEET', emoji: '🩺', tagline: 'Medical entrance',
    subjects: ['Botany', 'Zoology', 'Physics', 'Chemistry', 'Mixed'],
    style: 'NEET-UG (India medical entrance) exam pattern — NCERT Class 11-12 syllabus, single-correct MCQs like the real paper',
    qtypes: ['Standard MCQ', 'Assertion-Reason', 'Statement Based'],
    secondsPerQ: 60, pattern: '200 Q · 200 min · +4 / −1',
    topics: {
      Botany: ['Photosynthesis', 'Plant Kingdom', 'Cell Biology', 'Genetics & Evolution', 'Plant Physiology', 'Ecology', 'Molecular Biology', 'Morphology of Plants'],
      Zoology: ['Human Physiology', 'Animal Kingdom', 'Reproduction', 'Biotechnology', 'Human Health & Disease', 'Evolution', 'Biomolecules', 'Neural Control'],
      Physics: ['Mechanics', 'Thermodynamics', 'Electrostatics', 'Current Electricity', 'Magnetism', 'Optics', 'Modern Physics', 'Semiconductors'],
      Chemistry: ['Organic Chemistry', 'Chemical Bonding', 'Equilibrium', 'Coordination Compounds', 'Biomolecules', 'Thermodynamics', 'Electrochemistry', 'p-Block Elements'],
    },
  },
  {
    key: 'jee', name: 'JEE', emoji: '⚙️', tagline: 'Engineering entrance',
    subjects: ['Physics', 'Chemistry', 'Maths', 'Mixed'],
    style: 'JEE Main (India engineering entrance) exam pattern — Class 11-12 syllabus, conceptual and numerical single-correct MCQs',
    qtypes: ['Standard MCQ', 'Numerical Value', 'Assertion-Reason'],
    secondsPerQ: 120, pattern: '90 Q · 180 min · +4 / −1',
    topics: {
      Physics: ['Kinematics', 'Rotational Motion', 'Thermodynamics', 'Electromagnetism', 'Optics', 'Modern Physics', 'Waves & SHM', 'Current Electricity'],
      Chemistry: ['Physical Chemistry', 'Organic Chemistry', 'Inorganic Chemistry', 'Equilibrium', 'Electrochemistry', 'Chemical Kinetics', 'Coordination Compounds', 'Thermodynamics'],
      Maths: ['Calculus', 'Coordinate Geometry', 'Algebra', 'Trigonometry', 'Vectors & 3D', 'Probability', 'Complex Numbers', 'Matrices & Determinants'],
    },
  },
  {
    key: 'norcet', name: 'NORCET', emoji: '💉', tagline: 'AIIMS nursing officer',
    subjects: [
      'Mixed',
      'Fundamentals of Nursing', 'Medical Surgical Nursing', 'Community Health Nursing', 'Pharmacology',
      'Anatomy', 'Physiology', 'Nutrition', 'Microbiology', 'Biochemistry', 'Pathology',
      'Psychology', 'Sociology', 'Nursing Research', 'Statistics', 'Nursing Management',
      'Mental Health Nursing', 'Psychiatric Nursing', 'Obstetrics Nursing', 'Gynecological Nursing', 'Midwifery',
      'Pediatric Nursing', 'Emergency Nursing', 'Critical Care Nursing',
      'Cardiology Nursing', 'Neurology Nursing', 'Nephrology Nursing', 'Respiratory Nursing',
      'Gastroenterology Nursing', 'Endocrine Nursing', 'Orthopedic Nursing', 'Oncology Nursing',
      'Infection Control', 'Medical Ethics', 'Legal Aspects', 'Computer in Nursing',
      'Health Education', 'Environmental Hygiene',
    ],
    style: 'NORCET / AIIMS Nursing Officer exam pattern — clinical, applied nursing questions exactly like the real recruitment exam, with AIIMS-favourite points',
    secondsPerQ: 54, pattern: '100 Q · 90 min · +1 / −⅓',
    qtypes: [
      'Standard MCQ', 'Clinical Scenario', 'Priority Question', 'Drug Dose & Calculation', 'Case Study',
      'Assertion & Reason', 'Match the Following', 'Multiple Correct', 'Fill in the Blank',
      'Lab Values', 'ECG Interpretation', 'X-Ray Interpretation', 'Instrument Identification',
    ],
    topics: {
      'Fundamentals of Nursing': [
        'Vital Signs', 'Infection Control & Asepsis', 'Wound Care & Dressing', 'Oxygen Therapy',
        'IV Therapy & Fluids', 'Catheterization', 'NG Tube & Feeding', 'Positioning', 'Documentation', 'Body Mechanics', 'First Aid',
      ],
      'Medical Surgical Nursing': [
        'Hypertension', 'Heart Failure', 'Myocardial Infarction', 'Shock', 'Arrhythmias',
        'Asthma', 'COPD', 'ARDS', 'Pneumonia', 'Tuberculosis',
        'AKI', 'CKD', 'Dialysis', 'Diabetes Mellitus', 'DKA', 'Hypoglycemia', 'Thyroid Disorders',
        'Stroke', 'Epilepsy', 'Meningitis', 'Parkinson Disease',
        'Burns', 'Fractures & Traction', 'Pressure Ulcers', 'Cancer Care',
      ],
      'Community Health Nursing': [
        'National Health Programmes', 'Immunization & Cold Chain', 'Epidemiology', 'Biomedical Waste',
        'Health Committees', 'Vital Statistics', 'Primary Health Care', 'Family Planning',
      ],
      Pharmacology: [
        'Emergency Drugs', 'Antibiotics', 'Analgesics', 'Cardiac Drugs', 'Insulin & OHA',
        'IV Fluids', 'Drug Calculations', 'Adverse Effects & Antidotes', 'Anticoagulants', 'Drug Schedules',
      ],
      Anatomy: ['Cardiovascular System', 'Respiratory System', 'Nervous System', 'Digestive System', 'Renal System', 'Skeletal System', 'Endocrine Glands'],
      Physiology: ['Blood & Hemostasis', 'Cardiac Cycle', 'Respiration', 'Nerve & Muscle', 'Renal Physiology', 'Hormones', 'Homeostasis'],
      Nutrition: ['Macronutrients', 'Vitamins & Deficiencies', 'Minerals', 'Therapeutic Diets', 'Enteral & Parenteral Nutrition', 'BMI & Malnutrition'],
      Microbiology: ['Bacteria', 'Viruses', 'Sterilization & Disinfection', 'Immunity', 'Nosocomial Infections', 'Specimen Collection'],
      Biochemistry: ['Carbohydrate Metabolism', 'Proteins & Enzymes', 'Lipids', 'Vitamins', 'Acid-Base Balance', 'Liver & Kidney Function Tests'],
      Pathology: ['Inflammation', 'Neoplasia', 'Anemias', 'Edema & Shock', 'Cell Injury', 'Blood Groups'],
      Psychology: ['Learning & Memory', 'Motivation & Emotion', 'Intelligence', 'Personality', 'Defense Mechanisms', 'Stress & Coping'],
      Sociology: ['Family & Society', 'Social Groups', 'Culture', 'Social Problems', 'Health & Society'],
      'Nursing Research': ['Research Process', 'Research Designs', 'Sampling', 'Data Collection Tools', 'Hypothesis', 'Ethics in Research'],
      Statistics: ['Measures of Central Tendency', 'Measures of Dispersion', 'Normal Distribution', 'Correlation', 'Tests of Significance', 'Graphs'],
      'Nursing Management': ['Management Functions', 'Leadership Styles', 'Planning & Staffing', 'Ward Management', 'Quality Assurance', 'Nursing Standards'],
      'Mental Health Nursing': ['Anxiety Disorders', 'Mood Disorders', 'Therapeutic Communication', 'Defense Mechanisms', 'Crisis Intervention', 'Community Mental Health'],
      'Psychiatric Nursing': ['Schizophrenia', 'Depression & Mania', 'Personality Disorders', 'Substance Abuse', 'Psychiatric Drugs', 'ECT'],
      'Obstetrics Nursing': ['Antenatal Care', 'Stages of Labour', 'Partograph', 'Postnatal Care', 'PPH', 'Eclampsia & PIH', 'High-Risk Pregnancy'],
      'Gynecological Nursing': ['Menstrual Disorders', 'Contraception', 'PID', 'Cancer Cervix & Breast', 'Menopause', 'Infertility'],
      Midwifery: ['Normal Labour', 'Mechanism of Labour', 'Newborn Care', 'Breastfeeding', 'Neonatal Resuscitation', 'Episiotomy'],
      'Pediatric Nursing': ['Growth & Development', 'Immunization Schedule', 'IMNCI', 'Neonatal Disorders', 'Congenital Anomalies', 'Malnutrition', 'Pediatric Emergencies'],
      'Emergency Nursing': ['Triage', 'CPR & BLS/ACLS', 'Poisoning', 'Trauma Management', 'Burns', 'Snake Bite'],
      'Critical Care Nursing': ['Ventilator Care', 'ABG Analysis', 'Shock', 'Hemodynamic Monitoring', 'ICU Protocols', 'Defibrillation'],
      'Cardiology Nursing': ['ECG Basics', 'Myocardial Infarction', 'Heart Failure', 'Arrhythmias', 'Cardiac Drugs', 'Cardiac Catheterization'],
      'Neurology Nursing': ['Stroke', 'GCS & Neuro Assessment', 'Epilepsy', 'Meningitis', 'Head Injury', 'Parkinson Disease'],
      'Nephrology Nursing': ['AKI', 'CKD', 'Hemodialysis', 'Peritoneal Dialysis', 'Fluid & Electrolytes', 'Renal Transplant'],
      'Respiratory Nursing': ['Asthma', 'COPD', 'Pneumonia', 'Tuberculosis', 'Oxygen Delivery Devices', 'Chest Drainage'],
      'Gastroenterology Nursing': ['Peptic Ulcer', 'Liver Cirrhosis', 'Pancreatitis', 'GI Bleeding', 'Hepatitis', 'Stoma Care'],
      'Endocrine Nursing': ['Diabetes Mellitus', 'DKA', 'Thyroid Disorders', 'Adrenal Disorders', 'Pituitary Disorders', 'Insulin Therapy'],
      'Orthopedic Nursing': ['Fractures', 'Traction & Casts', 'Osteoporosis', 'Amputation', 'Joint Replacement', 'Spinal Injury'],
      'Oncology Nursing': ['Chemotherapy', 'Radiotherapy', 'Cancer Warning Signs', 'Palliative Care', 'Oncologic Emergencies', 'Pain Management'],
      'Infection Control': ['Hand Hygiene', 'PPE', 'Isolation Precautions', 'Sterilization', 'Biomedical Waste', 'Needle-Stick Injury'],
      'Medical Ethics': ['Principles of Ethics', 'Informed Consent', 'Patient Rights', 'Confidentiality', 'Euthanasia', 'Ethical Dilemmas'],
      'Legal Aspects': ['Consent', 'Negligence & Malpractice', 'Documentation & Records', 'Nursing Acts', 'Consumer Protection Act', 'MTP Act'],
      'Computer in Nursing': ['Computer Basics', 'Hospital Information Systems', 'Telemedicine', 'Nursing Informatics', 'Data Security', 'MS Office'],
      'Health Education': ['Principles of Teaching', 'Communication', 'AV Aids', 'IEC', 'Behaviour Change', 'Community Education'],
      'Environmental Hygiene': ['Water & Sanitation', 'Waste Disposal', 'Air & Ventilation', 'Housing', 'Vector Control', 'Occupational Health'],
    },
  },
  {
    key: 'upsc', name: 'UPSC', emoji: '🏛️', tagline: 'Civil services',
    subjects: ['Polity', 'History', 'Geography', 'Economy', 'Environment', 'Science & Tech', 'Art & Culture', 'Mixed'],
    style: 'UPSC Civil Services Prelims (GS Paper 1) pattern — analytical, statement-based questions where suitable',
    qtypes: ['Standard MCQ', 'Statement Based', 'Match the Following', 'Assertion & Reason'],
    secondsPerQ: 72, pattern: 'Prelims GS-I: 100 Q · 120 min · +2 / −⅔',
    topics: {
      Polity: ['Constitution & Amendments', 'Fundamental Rights', 'Parliament', 'Judiciary', 'Federalism', 'Local Government', 'Elections'],
      History: ['Ancient India', 'Medieval India', 'Modern India', 'Freedom Struggle', 'Post-Independence', 'Indian National Movement'],
      Geography: ['Physical Geography', 'Indian Geography', 'World Geography', 'Climatology', 'Resources', 'Agriculture'],
      Economy: ['Basic Concepts', 'Banking & Finance', 'Budget & Taxation', 'Planning', 'External Sector', 'Government Schemes'],
      Environment: ['Ecology', 'Biodiversity', 'Climate Change', 'Conservation', 'Pollution', 'Environmental Laws'],
      'Science & Tech': ['Space & Defence', 'Biotechnology', 'IT & Computers', 'Health & Diseases', 'Recent Innovations'],
      'Art & Culture': ['Architecture', 'Dance & Music', 'Paintings', 'Festivals', 'Literature', 'UNESCO Sites'],
    },
  },
  {
    key: 'ca', name: 'Current Affairs', emoji: '📰', tagline: 'News & events GK',
    subjects: ['National', 'International', 'Sports', 'Science & Tech', 'Awards & Honours', 'Mixed'],
    style: 'competitive-exam current-affairs section — events, appointments, schemes, awards, sports and summits from recent years, plus linked static GK; only well-established facts you are sure of',
    secondsPerQ: 40, pattern: 'GA section pace · ~40s / Q',
    topics: {
      National: ['Government Schemes', 'Appointments', 'Bills & Acts', 'Reports & Indices', 'Summits in India'],
      International: ['Summits & Conferences', 'Bilateral Relations', 'Global Organizations', 'Treaties'],
      Sports: ['Olympics & Asian Games', 'Cricket', 'Tournaments & Winners', 'Sports Awards'],
      'Science & Tech': ['Space Missions', 'Defence & Weapons', 'Tech Launches', 'Health & Vaccines'],
      'Awards & Honours': ['Civilian Awards', 'Nobel Prizes', 'Film Awards', 'Gallantry Awards'],
    },
  },
  {
    key: 'banking', name: 'Banking', emoji: '🏦', tagline: 'IBPS · SBI · RBI',
    subjects: ['Quantitative Aptitude', 'Reasoning', 'Banking Awareness', 'English', 'Mixed'],
    style: 'IBPS / SBI bank exam pattern (Prelims + Mains style)',
    secondsPerQ: 36, pattern: 'Prelims: 100 Q · 60 min · −¼',
    topics: {
      'Quantitative Aptitude': ['Simplification', 'Number Series', 'Data Interpretation', 'Quadratic Equations', 'Percentage', 'Profit & Loss', 'Time & Work'],
      Reasoning: ['Puzzles & Seating', 'Syllogism', 'Blood Relations', 'Coding-Decoding', 'Inequalities', 'Direction Sense'],
      'Banking Awareness': ['RBI & Monetary Policy', 'Banking Terms', 'Types of Accounts', 'Financial Institutions', 'Banking History'],
      English: ['Reading Comprehension', 'Cloze Test', 'Error Spotting', 'Para Jumbles', 'Fillers'],
    },
  },
  {
    key: 'ssc', name: 'SSC', emoji: '🏢', tagline: 'CGL · CHSL · MTS · GD',
    subjects: ['General Awareness', 'Quantitative Aptitude', 'Reasoning', 'English', 'Mixed'],
    style: 'SSC (CGL / CHSL / MTS / GD) exam pattern',
    secondsPerQ: 36, pattern: 'Tier-1: 100 Q · 60 min · −½',
    topics: {
      'General Awareness': ['History', 'Geography', 'Polity', 'Economics', 'General Science', 'Current Affairs', 'Static GK'],
      'Quantitative Aptitude': ['Arithmetic', 'Algebra', 'Geometry', 'Trigonometry', 'Data Interpretation', 'Mensuration'],
      Reasoning: ['Analogy', 'Series', 'Coding-Decoding', 'Non-Verbal', 'Classification', 'Blood Relations'],
      English: ['Vocabulary', 'Grammar', 'Comprehension', 'Idioms & Phrases', 'One Word Substitution'],
    },
  },
  {
    key: 'railways', name: 'Railways', emoji: '🚆', tagline: 'NTPC · Group D · ALP · JE',
    subjects: ['General Awareness', 'Maths', 'Reasoning', 'General Science', 'Mixed'],
    style: 'Indian Railways RRB exam pattern (NTPC, Group D, ALP, JE, RPF)',
    secondsPerQ: 54, pattern: 'NTPC CBT-1: 100 Q · 90 min · −⅓',
    topics: {
      'General Awareness': ['Current Affairs', 'Indian Polity', 'History', 'Geography', 'Static GK', 'Railway GK'],
      Maths: ['Number System', 'Percentage', 'Ratio & Proportion', 'Time & Distance', 'Mensuration', 'Simple & Compound Interest'],
      Reasoning: ['Analogy', 'Coding-Decoding', 'Syllogism', 'Series', 'Statement & Conclusion', 'Venn Diagrams'],
      'General Science': ['Physics', 'Chemistry', 'Biology', 'Environmental Science'],
    },
  },
  {
    key: 'groups', name: 'Groups', emoji: '🎯', tagline: 'Group 1 · 2 · 3 · 4',
    subjects: ['Group 1', 'Group 2', 'Group 3', 'Group 4', 'Mixed'],
    style: 'State PSC Groups services exam pattern (TSPSC / APPSC style) — General Studies, state history, culture, geography, economy, polity and current affairs, pitched at the level of the chosen Group (Group 1 toughest, Group 4 basic)',
    secondsPerQ: 60, pattern: 'Screening/Mains: 150 Q · 150 min',
    topics: {
      'Group 1': ['History & Culture', 'Polity & Governance', 'Economy', 'Geography', 'Science & Tech', 'Current Affairs', 'Data & Analytical Ability'],
      'Group 2': ['Polity', 'History', 'Economy', 'State GK', 'Current Affairs', 'Mental Ability'],
      'Group 3': ['General Studies', 'State Economy', 'Current Affairs', 'Arithmetic'],
      'Group 4': ['General Studies', 'General Science', 'Current Affairs', 'Arithmetic & Reasoning'],
    },
  },
  {
    key: 'mro', name: 'MRO / VRO', emoji: '🏘️', tagline: 'Revenue dept exams',
    subjects: ['Land Revenue & Rural Admin', 'State GK & Culture', 'Polity', 'Economy', 'Current Affairs', 'Arithmetic & Reasoning', 'Mixed'],
    style: 'MRO / VRO Revenue department recruitment exam pattern (Telangana / Andhra Pradesh style) — village and mandal administration, land revenue system, rural development schemes and state-specific General Studies',
    secondsPerQ: 60, pattern: '150 Q · 150 min',
    topics: {
      'Land Revenue & Rural Admin': ['Village Administration', 'Land Records & Survey', 'Revenue System', 'Rural Development Schemes', 'Panchayati Raj', 'Disaster Management'],
      'Arithmetic & Reasoning': ['Number System', 'Percentage', 'Averages', 'Series', 'Coding-Decoding', 'Data Interpretation'],
    },
  },
  {
    key: 'statepsc', name: 'State Exams', emoji: '🗳️', tagline: 'PSC · Panchayat Secretary',
    subjects: ['State GK & Culture', 'Polity', 'History', 'Geography', 'Economy', 'Science', 'Current Affairs', 'Mixed'],
    style: 'State Public Service Commission exam pattern (Panchayat Secretary, Endowments, other state posts) — state-specific GK, history, culture and schemes where relevant',
    secondsPerQ: 60, pattern: '150 Q · 150 min',
    topics: {
      Polity: ['Constitution', 'Panchayati Raj', 'State Government', 'Rights & Duties'],
      History: ['Ancient', 'Medieval', 'Modern', 'State History', 'Freedom Movement'],
      Geography: ['Indian Geography', 'State Geography', 'Physical Geography', 'Resources'],
      Economy: ['Indian Economy', 'State Economy', 'Schemes', 'Banking'],
    },
  },
  {
    key: 'police', name: 'Police', emoji: '🚔', tagline: 'SI · Constable',
    subjects: ['General Studies', 'Reasoning', 'Maths', 'Current Affairs', 'Mixed'],
    style: 'State Police SI / Constable recruitment exam pattern',
    secondsPerQ: 60, pattern: '200 Q · 180-200 min',
    topics: {
      'General Studies': ['History', 'Polity', 'Geography', 'General Science', 'Static GK'],
      Reasoning: ['Analogy', 'Series', 'Coding-Decoding', 'Non-Verbal', 'Blood Relations'],
      Maths: ['Arithmetic', 'Percentage', 'Ratio', 'Time & Work', 'Mensuration'],
    },
  },
  {
    key: 'teaching', name: 'Teaching', emoji: '🧑‍🏫', tagline: 'CTET · TET · DSC',
    subjects: ['Child Development & Pedagogy', 'Maths', 'EVS', 'Science', 'Social Studies', 'Language', 'Mixed'],
    style: 'CTET / State TET / DSC teacher recruitment exam pattern',
    secondsPerQ: 60, pattern: 'CTET: 150 Q · 150 min · no negative marking',
    topics: {
      'Child Development & Pedagogy': ['Development Concepts', 'Learning Theories', 'Inclusive Education', 'Assessment', 'Motivation', 'Piaget & Vygotsky'],
      Maths: ['Number System', 'Geometry', 'Data Handling', 'Pedagogy of Maths'],
      EVS: ['Family & Friends', 'Water & Shelter', 'Plants & Animals', 'Pedagogy of EVS'],
      'Social Studies': ['History', 'Geography', 'Civics', 'Pedagogy of Social Science'],
    },
  },
  {
    key: 'gate', name: 'GATE', emoji: '🎓', tagline: 'Engineering PG',
    subjects: ['CS & IT', 'Mechanical', 'Civil', 'Electrical', 'Electronics', 'Engineering Maths'],
    style: 'GATE exam pattern — concept-heavy, applied engineering questions',
    qtypes: ['Standard MCQ', 'Numerical Value', 'Multiple Correct'],
    secondsPerQ: 165, pattern: '65 Q · 180 min · MCQ −⅓ / MSQ & NAT no negative',
    topics: {
      'CS & IT': ['Data Structures', 'Algorithms', 'Operating Systems', 'DBMS', 'Computer Networks', 'Theory of Computation', 'Digital Logic', 'Compiler Design'],
      Mechanical: ['Thermodynamics', 'Fluid Mechanics', 'Strength of Materials', 'Theory of Machines', 'Manufacturing', 'Heat Transfer'],
      Civil: ['Structural Analysis', 'Geotechnical', 'Fluid Mechanics', 'Transportation', 'Environmental Engg', 'Surveying'],
      Electrical: ['Circuits', 'Power Systems', 'Control Systems', 'Machines', 'Power Electronics', 'Signals'],
      Electronics: ['Networks', 'Electronic Devices', 'Analog Circuits', 'Digital Circuits', 'Signals & Systems', 'Communications'],
      'Engineering Maths': ['Linear Algebra', 'Calculus', 'Differential Equations', 'Probability', 'Numerical Methods'],
    },
  },
  {
    key: 'defence', name: 'Defence', emoji: '🎖️', tagline: 'NDA · CDS · AFCAT',
    subjects: ['Maths', 'General Ability', 'English', 'Mixed'],
    style: 'NDA / CDS defence entrance exam pattern',
    secondsPerQ: 55, pattern: 'NDA: Maths 120 Q · GAT 150 Q · −⅓',
    topics: {
      Maths: ['Algebra', 'Trigonometry', 'Calculus', 'Coordinate Geometry', 'Statistics & Probability', 'Matrices'],
      'General Ability': ['Physics', 'Chemistry', 'General Science', 'History', 'Geography', 'Current Affairs', 'Polity'],
      English: ['Grammar', 'Vocabulary', 'Comprehension', 'Sentence Improvement', 'Antonyms & Synonyms'],
    },
  },
  {
    key: 'aptitude', name: 'Aptitude', emoji: '🧮', tagline: 'Placement prep',
    subjects: ['Quantitative', 'Logical Reasoning', 'Verbal', 'Data Interpretation', 'Mixed'],
    style: 'campus-placement aptitude test pattern (TCS / Infosys / accenture style)',
    secondsPerQ: 60, pattern: 'Placement round · ~60s / Q',
    topics: {
      Quantitative: ['Number System', 'Percentage', 'Profit & Loss', 'Time-Speed-Distance', 'Time & Work', 'Permutation & Combination', 'Probability'],
      'Logical Reasoning': ['Series', 'Blood Relations', 'Syllogism', 'Seating Arrangement', 'Coding-Decoding', 'Puzzles'],
      Verbal: ['Reading Comprehension', 'Sentence Correction', 'Synonyms & Antonyms', 'Para Jumbles'],
      'Data Interpretation': ['Tables', 'Bar Graphs', 'Pie Charts', 'Line Graphs', 'Caselets'],
    },
  },
  {
    key: 'coding', name: 'Coding', emoji: '💻', tagline: 'CS & programming',
    subjects: ['Python', 'JavaScript', 'Java', 'C', 'DSA', 'SQL', 'Mixed'],
    style: 'programming and computer-science MCQs, with short code snippets in questions where useful',
    qtypes: ['Standard MCQ', 'Output Prediction', 'Fill in the Blank'],
    secondsPerQ: 75, pattern: 'Concept + code-output MCQs',
    topics: {
      Python: ['Data Types', 'Functions', 'OOP', 'List & Dict', 'Exceptions', 'Comprehensions', 'Decorators'],
      JavaScript: ['Closures', 'Promises & Async', 'Prototypes', 'ES6 Features', 'Event Loop', 'this Keyword'],
      Java: ['OOP Concepts', 'Collections', 'Exceptions', 'Multithreading', 'Generics', 'JVM'],
      C: ['Pointers', 'Arrays & Strings', 'Memory Management', 'Structures', 'File Handling'],
      DSA: ['Arrays', 'Linked Lists', 'Trees', 'Sorting & Searching', 'Graphs', 'Dynamic Programming', 'Time Complexity'],
      SQL: ['Joins', 'Aggregations', 'Subqueries', 'Indexes', 'Normalization', 'Transactions'],
    },
  },
  {
    key: 'english', name: 'English', emoji: '🇬🇧', tagline: 'Grammar & vocab',
    subjects: ['Grammar', 'Vocabulary', 'Idioms & Phrases', 'Comprehension', 'Mixed'],
    style: 'competitive-exam English section pattern',
    secondsPerQ: 45, pattern: 'Language section · ~45s / Q',
    topics: {
      Grammar: ['Tenses', 'Articles', 'Prepositions', 'Subject-Verb Agreement', 'Error Spotting', 'Sentence Improvement'],
      Vocabulary: ['Synonyms', 'Antonyms', 'One Word Substitution', 'Spellings', 'Word Usage'],
      'Idioms & Phrases': ['Common Idioms', 'Phrasal Verbs', 'Proverbs'],
      Comprehension: ['Reading Passages', 'Cloze Test', 'Para Jumbles', 'Inference'],
    },
  },
  {
    key: 'gk', name: 'General Knowledge', emoji: '🌍', tagline: 'Static GK',
    subjects: ['India', 'World', 'Science', 'History', 'Sports', 'Mixed'],
    style: 'static general-knowledge quiz for competitive exams',
    secondsPerQ: 40, pattern: 'GK round · ~40s / Q',
    topics: {
      India: ['States & Capitals', 'National Symbols', 'Rivers & Mountains', 'Monuments', 'Dance & Festivals', 'Constitution Basics'],
      World: ['Countries & Capitals', 'Currencies', 'World Organizations', 'Wonders', 'Rivers & Deserts'],
      Science: ['Physics Facts', 'Chemistry Facts', 'Biology Facts', 'Inventions & Discoveries', 'Units & Measurements'],
      History: ['Ancient', 'Medieval', 'Modern', 'World History', 'Freedom Fighters'],
      Sports: ['Olympics', 'Cricket', 'Trophies & Cups', 'Sports Personalities'],
    },
  },
]

export function QuizPage() {
  const { addXp, profile } = useAuth()
  const { rows: history, insert: saveResult } = useTable<QuizResult>('quiz_results', { orderBy: 'created_at' })
  const { rows: notes } = useTable<Note>('notes', { orderBy: 'updated_at' })

  const [phase, setPhase] = useState<Phase>('setup')
  // two-step setup keeps the mobile UI clean: pick an exam, then configure
  const [stage, setStage] = useState<'pick' | 'config'>('pick')
  const [exam, setExam] = useState<ExamSpec | null>(null)   // null = custom topic mode
  const [subject, setSubject] = useState('Mixed')
  const [qsrc, setQsrc] = useState<'pyq' | 'repeated' | 'fresh'>('pyq')
  const [freshFlavour, setFreshFlavour] = useState('Standard') // Standard | Expected | Clinical | NCLEX | Rapid
  const [pyqYear, setPyqYear] = useState<(typeof PYQ_YEARS)[number]>('Any')
  const [qtype, setQtype] = useState('Standard MCQ')        // special formats (clinical, priority, dose…)
  const [mock, setMock] = useState(false)                   // timed + negative marking
  const [negMark, setNegMark] = useState(true)              // mock: −⅓ per wrong answer
  const [timed, setTimed] = useState(true)                  // mock: countdown timer on
  const [stateName, setStateName] = useState('')            // for state-level exams (Groups/MRO/Police/DSC)
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>('Medium')
  const [count, setCount] = useState<(typeof COUNTS)[number]>(5)
  const [noteId, setNoteId] = useState('')
  const [error, setError] = useState('')

  const [playedTopic, setPlayedTopic] = useState('')
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [i, setI] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [correct, setCorrect] = useState(0)
  const [wrongCnt, setWrongCnt] = useState(0)
  const [earned, setEarned] = useState(0)
  const [remaining, setRemaining] = useState(0)             // mock countdown, seconds
  const [wasMock, setWasMock] = useState(false)             // the played quiz used mock rules
  const [wasNeg, setWasNeg] = useState(false)               // negative marking was on for this run

  // on-demand deep explanation for the current question
  const [detail, setDetail] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)

  // revision stores + teach-me
  const [wrong, setWrong] = useState<SavedQ[]>(() => loadStore(WRONG_KEY))
  const [marks, setMarks] = useState<SavedQ[]>(() => loadStore(MARK_KEY))
  const [teachOpen, setTeachOpen] = useState(false)
  const [teachText, setTeachText] = useState('')
  const [teachLoading, setTeachLoading] = useState(false)
  const [drilling, setDrilling] = useState(false)           // building a "drill my mistakes" quiz

  // AI study planner
  const [planOpen, setPlanOpen] = useState(false)
  const [planDate, setPlanDate] = useState('')
  const [planHours, setPlanHours] = useState(4)
  const [planLevel, setPlanLevel] = useState('Intermediate')
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState('')
  const [plan, setPlan] = useState<ExamStudyPlan | null>(null)

  const voice = useSpeech()

  /** this exam's real per-question pace (drives the mock timer + estimate) */
  const secPerQ = exam?.secondsPerQ ?? DEFAULT_SECONDS_PER_Q
  /** this exam's real marking scheme (drives the marks card + scoring note) */
  const mk = MARKING[exam?.key ?? ''] ?? DEFAULT_MARKING

  /** true for exams where the user's state matters (Groups/MRO/Police/DSC) */
  const isStateExam = !!exam && ['groups', 'mro', 'statepsc', 'police', 'teaching'].includes(exam.key)

  async function start() {
    const note = exam ? undefined : notes.find((n) => n.id === noteId)
    // strip the note's rich-text HTML down to plain study material
    const source = note ? note.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''
    // state-level exams get the user's state woven into the name + style
    const examName = exam ? (isStateExam && stateName.trim() ? `${stateName.trim()} ${exam.name}` : exam.name) : ''
    let examStyle = exam
      ? exam.style + (isStateExam && stateName.trim() ? ` Focus on ${stateName.trim()} state-specific GK, history, culture, rivers, schemes and current affairs where relevant.` : '')
      : undefined
    // special question format (clinical scenario / priority / dose calc…)
    if (exam && qtype !== 'Standard MCQ' && QTYPE_STYLE[qtype]) examStyle = `${examStyle} ${QTYPE_STYLE[qtype]}`
    // year filter for previous-year mode
    if (exam && qsrc === 'pyq' && pyqYear !== 'Any') {
      examStyle = `${examStyle} Use ONLY questions that appeared in the ${pyqYear} paper(s)/session(s) of this exam, and tag "asked" with that session.`
    }
    // fresh-mode flavour (Expected / Clinical / NCLEX / Rapid)
    if (exam && qsrc === 'fresh' && SOURCE_STYLE[freshFlavour]) examStyle = `${examStyle} ${SOURCE_STYLE[freshFlavour]}`
    // for big mock papers, batch generation so we hit the requested count
    // without one oversized request truncating (10 questions per call)
    const genAll = async (): Promise<QuizQuestion[]> => {
      if (count <= 10) return generateQuiz({ topic: aiTopic, difficulty, count, source: source || undefined, style: examStyle, mode: exam ? qsrc : 'fresh' })
      const acc: QuizQuestion[] = []
      while (acc.length < count) {
        const batch = await generateQuiz({
          topic: aiTopic, difficulty, count: Math.min(10, count - acc.length),
          source: source || undefined, style: examStyle, mode: exam ? qsrc : 'fresh',
          avoid: acc.map((a) => a.q),
        })
        if (!batch.length) break
        acc.push(...batch)
      }
      return acc
    }
    // optional narrow topic under the subject (the Subject → Topic drill)
    const focus = exam ? topic.trim() : ''
    // what the AI is quizzed on vs. the short label saved to history
    const aiTopic = exam
      ? focus
        ? `${focus} — under ${subject === 'Mixed' ? examName : subject} (${examName} syllabus)`
        : (subject === 'Mixed' ? `the full ${examName} syllabus` : `${subject} (${examName} syllabus)`)
      : (topic.trim() || note?.title.trim() || '')
    const srcTag = qsrc === 'pyq' ? ` · 📜 PYQ${pyqYear !== 'Any' ? ` ${pyqYear}` : ''}` : qsrc === 'repeated' ? ' · 🔁 Repeated' : ''
    const label = exam
      ? `${exam.emoji} ${examName}${subject !== 'Mixed' ? ` · ${subject}` : ''}${focus ? ` · ${focus}` : ''}${srcTag}${mock ? ' · ⏱️ Mock' : ''}`
      : (topic.trim() || note?.title.trim() || '')
    if (!aiTopic) return
    setPhase('loading')
    setError('')
    try {
      const qs = await genAll()
      if (qs.length < 3) throw new Error('Leo could not build that quiz — try a clearer topic. 🦁')
      beginQuiz(qs, label, mock)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setPhase('setup')
    }
  }

  /** shared entry into the playing phase — used by start(), revise & drill. */
  function beginQuiz(qs: QuizQuestion[], label: string, isMock: boolean, negOn = negMark, timerOn = timed) {
    setPlayedTopic(label)
    setQuestions(qs)
    setI(0)
    setPicked(null)
    setCorrect(0)
    setWrongCnt(0)
    setDetail('')
    setWasMock(isMock)
    setWasNeg(isMock && negOn)
    setRemaining(isMock && timerOn ? qs.length * secPerQ : 0)
    setPhase('playing')
  }

  /** replay stored questions (Wrong-answers / Bookmarks) with no AI call. */
  function revise(store: SavedQ[], label: string) {
    if (store.length < 1) return
    // shuffle a little by rotating, so repeats aren't always in the same order
    beginQuiz(store.slice(0, 20), label, false)
  }

  function toggleBookmark(q: QuizQuestion) {
    const k = qKey(q)
    setMarks((prev) => {
      const exists = prev.some((m) => qKey(m) === k)
      const next = exists ? prev.filter((m) => qKey(m) !== k) : [{ ...q, topic: playedTopic }, ...prev]
      saveStore(MARK_KEY, next)
      return next
    })
  }

  function pick(idx: number) {
    if (picked !== null) return
    const cur = questions[i]
    setPicked(idx)
    if (idx === cur.answer) {
      setCorrect((c) => c + 1)
      // getting a previously-wrong question right removes it from revision
      setWrong((prev) => {
        if (!prev.some((w) => qKey(w) === qKey(cur))) return prev
        const next = prev.filter((w) => qKey(w) !== qKey(cur))
        saveStore(WRONG_KEY, next)
        return next
      })
    } else {
      setWrongCnt((w) => w + 1)
      // capture the mistake for later revision (dedup by question text)
      setWrong((prev) => {
        if (prev.some((w) => qKey(w) === qKey(cur))) return prev
        const next = [{ ...cur, topic: playedTopic }, ...prev]
        saveStore(WRONG_KEY, next)
        return next
      })
    }
  }

  /** AI "drill my mistakes" — fresh questions on the topics just missed. */
  async function drillMistakes() {
    if (drilling) return
    const missed = questions.filter((_, idx) => idx < i || picked !== null).filter((qq) => wrong.some((w) => qKey(w) === qKey(qq)))
    const seed = (missed.length ? missed : wrong).slice(0, 6).map((w) => w.q).join(' | ')
    if (!seed) return
    setDrilling(true)
    try {
      const qs = await generateQuiz({
        topic: `the concepts tested by these ${playedTopic} questions the student got WRONG: ${seed}`,
        difficulty, count: 5, mode: 'fresh',
        style: 'Generate NEW questions that drill the SAME underlying concepts the student missed, from slightly different angles so they truly learn them.',
      })
      if (qs.length >= 3) beginQuiz(qs, `🎯 Drilling mistakes · ${playedTopic}`, false)
    } catch { /* stay on results screen on failure */ } finally {
      setDrilling(false)
    }
  }

  async function teachThis() {
    if (teachLoading) return
    setTeachOpen(true)
    if (teachText) return
    setTeachLoading(true)
    try {
      setTeachText(await teachTopic(q.q, exam?.name ?? playedTopic))
    } catch (e) {
      setTeachText(e instanceof Error ? e.message : 'Could not load the lesson — try again.')
    } finally {
      setTeachLoading(false)
    }
  }

  /** wrap up the quiz — pays XP, saves history; also fired by the mock timer. */
  async function finalize() {
    setTeachText('')
    const xp = correct * 2 + (correct === questions.length ? 10 : 0)
    setEarned(xp)
    setPhase('done')
    if (xp > 0) await addXp(xp, `Quiz: ${playedTopic} ${correct}/${questions.length}`)
    try {
      await saveResult({ topic: playedTopic, difficulty, score: correct, total: questions.length, xp } as Partial<QuizResult>)
    } catch { /* quiz_results table not installed yet — the quiz itself still works */ }
  }

  // mock-mode countdown — re-armed every second so the closure stays fresh;
  // hitting zero auto-submits like the real exam (only when a timer is set)
  useEffect(() => {
    if (!wasMock || phase !== 'playing' || remaining <= 0) return
    const t = setTimeout(() => {
      if (remaining <= 1) void finalize()
      else setRemaining((r) => r - 1)
    }, 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasMock, phase, remaining])

  async function makePlan() {
    if (!exam || !planDate || planLoading) return
    const daysLeft = Math.max(1, Math.ceil((new Date(planDate).getTime() - Date.now()) / 86_400_000))
    setPlanLoading(true)
    setPlanError('')
    try {
      const examName = isStateExam && stateName.trim() ? `${stateName.trim()} ${exam.name}` : exam.name
      const p = await examStudyPlan({ exam: examName, daysLeft, hoursPerDay: planHours, level: planLevel })
      if (!p.phases.length) throw new Error('Leo could not build the plan — please try again. 🦁')
      setPlan(p)
      try { localStorage.setItem(`fl:examplan:${exam.key}`, JSON.stringify({ date: planDate, plan: p })) } catch { /* best-effort */ }
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setPlanLoading(false)
    }
  }

  function openPlanner() {
    if (!exam) return
    setPlanOpen(true)
    setPlanError('')
    // restore this exam's saved plan so reopening costs no AI call
    try {
      const cached = localStorage.getItem(`fl:examplan:${exam.key}`)
      if (cached) {
        const j = JSON.parse(cached) as { date: string; plan: ExamStudyPlan }
        setPlan(j.plan)
        setPlanDate(j.date)
        return
      }
    } catch { /* fresh form */ }
    setPlan(null)
  }

  async function explainMore() {
    if (detailLoading || detail) return
    setDetailLoading(true)
    try {
      const text = await explainQuizQuestion({ q: q.q, options: q.options, answer: q.answer, topic: playedTopic })
      setDetail(text || 'Leo had no more to add on this one. 🦁')
    } catch (e) {
      setDetail(e instanceof Error ? e.message : 'Could not load the explanation — try again.')
    } finally {
      setDetailLoading(false)
    }
  }

  async function next() {
    if (i + 1 < questions.length) {
      setI(i + 1)
      setPicked(null)
      setDetail('')
      voice.stop()
      return
    }
    // finished — `correct` already includes this question (picked before Next)
    await finalize()
  }

  const q = questions[i]
  const pct = questions.length ? Math.round((correct / questions.length) * 100) : 0
  const best = history.reduce((m, r) => Math.max(m, r.total ? Math.round((r.score / r.total) * 100) : 0), 0)

  // ---- lifetime stats from quiz history (right panel) ----
  const totalQ = history.reduce((a, r) => a + (r.total ?? 0), 0)
  const totalRight = history.reduce((a, r) => a + (r.score ?? 0), 0)
  const accuracy = totalQ ? Math.round((totalRight / totalQ) * 100) : 0
  const streak = profile?.study_streak ?? 0
  // exam readiness = blend of accuracy, practice volume and consistency (0-100)
  const readiness = Math.min(100, Math.round(accuracy * 0.6 + Math.min(30, history.length * 3) + Math.min(10, streak)))
  // weak / strong topic = lowest / highest average score per topic label
  const byTopic = new Map<string, { s: number; t: number }>()
  for (const r of history) {
    const short = r.topic.split(' · ')[0]
    const cur = byTopic.get(short) ?? { s: 0, t: 0 }
    byTopic.set(short, { s: cur.s + (r.score ?? 0), t: cur.t + (r.total ?? 0) })
  }
  const rated = [...byTopic.entries()].filter(([, v]) => v.t >= 5).map(([k, v]) => ({ k, pct: v.s / v.t }))
  const weakTopic = rated.length ? rated.reduce((m, x) => (x.pct < m.pct ? x : m)).k : null
  const strongTopic = rated.length ? rated.reduce((m, x) => (x.pct > m.pct ? x : m)).k : null

  // estimated time + marks for the configured quiz
  const estMin = Math.max(1, Math.round((count * secPerQ) / 60))
  const isBookmarked = q ? marks.some((m) => qKey(m) === qKey(q)) : false

  return (
    <Page title="Quiz Arena" subtitle="Pick any topic — Leo builds the quiz, you earn the XP. ⚔️">
      {phase === 'setup' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {stage === 'pick' ? (
            <GlassCard className="min-w-0 lg:col-span-2">
              <SectionTitle>Pick your exam</SectionTitle>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {EXAMS.map((ex) => (
                  <button key={ex.key}
                    onClick={() => {
                      setExam(ex)
                      setSubject(ex.subjects.includes('Mixed') ? 'Mixed' : ex.subjects[0])
                      setNoteId('')
                      setTopic('')
                      setQtype('Standard MCQ')
                      setStage('config')
                    }}
                    className={cn(
                      'min-w-0 rounded-2xl border p-2.5 sm:p-3 text-left transition active:scale-95',
                      exam?.key === ex.key
                        ? 'border-brand-400/60 bg-brand-500/15 shadow-lg shadow-brand-500/20'
                        : 'glass border-transparent hover:bg-brand-500/10',
                    )}>
                    <div className="text-xl sm:text-2xl">{ex.emoji}</div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-900 dark:text-white sm:text-sm">{ex.name}</div>
                    <div className="truncate text-[10px] text-slate-500">{ex.tagline}</div>
                  </button>
                ))}
                <button
                  onClick={() => { setExam(null); setTopic(''); setNoteId(''); setStage('config') }}
                  className={cn(
                    'min-w-0 rounded-2xl border p-2.5 sm:p-3 text-left transition active:scale-95',
                    exam === null
                      ? 'border-brand-400/60 bg-brand-500/15 shadow-lg shadow-brand-500/20'
                      : 'glass border-transparent hover:bg-brand-500/10',
                  )}>
                  <div className="text-xl sm:text-2xl">✏️</div>
                  <div className="mt-1 truncate text-xs font-bold text-slate-900 dark:text-white sm:text-sm">My topic</div>
                  <div className="truncate text-[10px] text-slate-500">Anything, or a note</div>
                </button>
              </div>
            </GlassCard>
          ) : (
          <GlassCard className="min-w-0 lg:col-span-2">
            {/* selected exam header + back arrow to the exam picker */}
            <div className="mb-4 flex items-center gap-3">
              <button
                onClick={() => setStage('pick')}
                aria-label="Back to all exams"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-500/10 text-slate-600 transition hover:bg-slate-500/20 active:scale-95 dark:bg-white/10 dark:text-slate-200"
              >
                <ArrowLeft size={19} />
              </button>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-500/15 text-2xl">
                {exam?.emoji ?? '✏️'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-extrabold text-slate-900 dark:text-white">{exam?.name ?? 'My topic'}</div>
                <div className="truncate text-xs text-slate-500">{exam?.tagline ?? 'Anything you want, or one of your notes'}</div>
              </div>
            </div>
            {/* real exam pattern + timing */}
            {exam?.pattern && (
              <div className="mb-4 flex items-center gap-1.5 rounded-2xl bg-slate-500/5 px-3.5 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <Timer size={13} className="shrink-0" />
                <span className="min-w-0 truncate">Real pattern · {exam.pattern}</span>
              </div>
            )}
            <div className="space-y-4">
              {/* custom topic mode */}
              {!exam && (
                <>
                  <Input
                    className="min-w-0"
                    placeholder="Topic — e.g. Photosynthesis, Python…"
                    value={topic} onChange={(e) => setTopic(e.target.value)}
                  />
                  {notes.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Quiz me on one of my notes (optional)</div>
                      <select value={noteId} onChange={(e) => setNoteId(e.target.value)}
                        className="w-full rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-3 py-2.5 text-sm text-slate-900 dark:text-white dark:[&>option]:bg-slate-800">
                        <option value="">No — just the topic above</option>
                        {notes.map((n) => <option key={n.id} value={n.id}>{n.title || '(untitled note)'}</option>)}
                      </select>
                    </div>
                  )}
                </>
              )}

              {/* subject for the chosen exam — pills, or a dropdown for big syllabi (NORCET) */}
              {exam && (
                <div>
                  <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Subject</div>
                  {exam.subjects.length > 8 ? (
                    <select value={subject} onChange={(e) => { setSubject(e.target.value); setTopic('') }}
                      className="w-full rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-3 py-2.5 text-sm text-slate-900 dark:text-white dark:[&>option]:bg-slate-800">
                      {exam.subjects.map((s) => <option key={s} value={s}>{s === 'Mixed' ? 'Mixed — full syllabus' : s}</option>)}
                    </select>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {exam.subjects.map((s) => (
                        <button key={s} onClick={() => { setSubject(s); setTopic('') }}
                          className={cn(
                            'rounded-2xl px-3 py-2 text-xs font-bold transition sm:px-3.5 sm:text-sm',
                            subject === s ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
                          )}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Subject → Topic drill: quick chips + free text */}
              {exam && subject !== 'Mixed' && (
                <div>
                  <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Narrow to a topic (optional)</div>
                  {(exam.topics?.[subject]?.length ?? 0) > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {exam.topics![subject].map((t) => (
                        <button key={t} onClick={() => setTopic(topic === t ? '' : t)}
                          className={cn(
                            'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                            topic === t ? 'bg-gradient-to-r from-purple-500 to-purple-400 text-white shadow-md shadow-purple-500/30' : 'bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-purple-500/15',
                          )}>
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                  <Input placeholder={`e.g. a specific ${subject} topic…`} value={topic} onChange={(e) => setTopic(e.target.value)} />
                </div>
              )}

              {/* special question formats (clinical / priority / dose / assertion-reason…) */}
              {exam?.qtypes && (
                <div>
                  <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Question type</div>
                  <div className="flex flex-wrap gap-2">
                    {exam.qtypes.map((t) => (
                      <button key={t} onClick={() => setQtype(t)}
                        className={cn(
                          'rounded-2xl px-3 py-2 text-xs font-bold transition sm:text-sm',
                          qtype === t ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 text-white shadow-lg shadow-emerald-500/30' : 'glass text-slate-600 dark:text-slate-300',
                        )}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* your state — for Groups/MRO/VRO, Police, DSC */}
              {isStateExam && (
                <div>
                  <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Your state (optional — makes GK state-specific)</div>
                  <Input placeholder="e.g. Telangana, Andhra Pradesh, UP, Maharashtra…"
                    value={stateName} onChange={(e) => setStateName(e.target.value)} />
                </div>
              )}

              {/* question source: PYQ / most repeated / fresh */}
              {exam && (
                <div>
                  <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Question source</div>
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => setQsrc('pyq')}
                      className={cn(
                        'rounded-2xl px-2 py-2.5 text-xs font-bold leading-tight transition sm:text-sm',
                        qsrc === 'pyq' ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-white shadow-lg shadow-amber-500/30' : 'glass text-slate-600 dark:text-slate-300',
                      )}>
                      📜 Previous year
                    </button>
                    <button onClick={() => setQsrc('repeated')}
                      className={cn(
                        'rounded-2xl px-2 py-2.5 text-xs font-bold leading-tight transition sm:text-sm',
                        qsrc === 'repeated' ? 'bg-gradient-to-r from-purple-500 to-purple-400 text-white shadow-lg shadow-purple-500/30' : 'glass text-slate-600 dark:text-slate-300',
                      )}>
                      🔁 Most repeated
                    </button>
                    <button onClick={() => setQsrc('fresh')}
                      className={cn(
                        'rounded-2xl px-2 py-2.5 text-xs font-bold leading-tight transition sm:text-sm',
                        qsrc === 'fresh' ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
                      )}>
                      ✨ Fresh
                    </button>
                  </div>
                  {qsrc === 'pyq' && (
                    <>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {PYQ_YEARS.map((y) => (
                          <button key={y} onClick={() => setPyqYear(y)}
                            className={cn(
                              'rounded-full px-3 py-1.5 text-xs font-bold transition',
                              pyqYear === y ? 'bg-amber-400 text-amber-950 shadow-md shadow-amber-400/40' : 'bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-amber-400/20',
                            )}>
                            {y === 'Any' ? 'All years' : y}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[11px] text-slate-400">
                        Real past-paper questions, each tagged with the exam session (month/year). Cross-check with official papers for final revision.
                      </p>
                    </>
                  )}
                  {qsrc === 'repeated' && (
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      The high-frequency questions asked again and again across years — the ones toppers revise first, tagged with the years they appeared.
                    </p>
                  )}
                  {/* fresh-mode flavour — only shown under Fresh, so it never clutters PYQ/Repeated */}
                  {qsrc === 'fresh' && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {['Standard', 'Expected', 'Clinical', 'NCLEX', 'Rapid'].map((f) => (
                        <button key={f} onClick={() => setFreshFlavour(f)}
                          className={cn(
                            'rounded-full px-3 py-1.5 text-xs font-bold transition',
                            freshFlavour === f ? 'bg-brand-500 text-white shadow-md shadow-brand-500/30' : 'bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-brand-500/15',
                          )}>
                          {f === 'NCLEX' ? 'NCLEX-style' : f === 'Rapid' ? 'Rapid revision' : f}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* quick revision from your saved sets — no AI call, replays stored questions */}
              {(wrong.length > 0 || marks.length > 0) && (
                <div>
                  <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Revision</div>
                  <div className="flex flex-wrap gap-2">
                    {wrong.length > 0 && (
                      <button onClick={() => revise(wrong, '❌ Wrong questions')}
                        className="rounded-2xl bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-500/20 dark:text-rose-400 sm:text-sm">
                        ❌ Wrong questions ({wrong.length})
                      </button>
                    )}
                    {marks.length > 0 && (
                      <button onClick={() => revise(marks, '🔖 Bookmarked')}
                        className="rounded-2xl bg-amber-400/15 px-3 py-2 text-xs font-bold text-amber-600 transition hover:bg-amber-400/25 dark:text-amber-300 sm:text-sm">
                        🔖 Bookmarked ({marks.length})
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* practice vs real-exam mock */}
              <div>
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Mode</div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setMock(false)}
                    className={cn(
                      'rounded-2xl px-3 py-2.5 text-xs font-bold leading-tight transition sm:text-sm',
                      !mock ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
                    )}>
                    📖 Practice — relaxed
                  </button>
                  <button onClick={() => setMock(true)}
                    className={cn(
                      'rounded-2xl px-3 py-2.5 text-xs font-bold leading-tight transition sm:text-sm',
                      mock ? 'bg-gradient-to-r from-rose-500 to-rose-400 text-white shadow-lg shadow-rose-500/30' : 'glass text-slate-600 dark:text-slate-300',
                    )}>
                    ⏱️ Mock — timed + negative marks
                  </button>
                </div>
                {mock && (
                  <div className="mt-2 space-y-1.5">
                    <label className="flex items-center justify-between rounded-2xl bg-slate-500/5 px-3.5 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      <span>⏱️ Timed ({secPerQ}s / question)</span>
                      <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} className="h-4 w-4 accent-rose-500" />
                    </label>
                    <label className="flex items-center justify-between rounded-2xl bg-slate-500/5 px-3.5 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      <span>➖ Negative marking (−⅓)</span>
                      <input type="checkbox" checked={negMark} onChange={(e) => setNegMark(e.target.checked)} className="h-4 w-4 accent-rose-500" />
                    </label>
                    <p className="text-[11px] text-slate-400">
                      {exam ? exam.name : 'Standard'} scoring: +{mk.pos} per correct{negMark && mk.neg > 0 ? `, −${fracGlyph(mk.neg)} per wrong` : ' (no negative marking)'}{timed ? ', auto-submit at 0:00' : ''}.
                    </p>
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Difficulty</div>
                <div className="grid grid-cols-4 gap-2">
                  {DIFFICULTIES.map((d) => (
                    <button key={d} onClick={() => setDifficulty(d)}
                      className={cn(
                        'rounded-2xl px-2 py-2.5 text-xs font-bold transition sm:text-sm',
                        difficulty === d ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
                      )}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Questions</div>
                <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
                  {COUNTS.map((c) => (
                    <button key={c} onClick={() => setCount(c)}
                      className={cn(
                        'rounded-2xl px-1 py-2.5 text-xs font-bold transition sm:text-sm',
                        count === c ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
                      )}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              {/* estimated time + marks summary */}
              <div className="flex items-center justify-center gap-4 rounded-2xl bg-slate-500/5 px-4 py-2.5 text-center text-xs">
                <div>
                  <span className="font-extrabold text-slate-900 dark:text-white">{count}</span>
                  <span className="text-slate-500"> questions</span>
                </div>
                <span className="text-slate-300 dark:text-white/20">·</span>
                <div>
                  <span className="font-extrabold text-slate-900 dark:text-white">≈ {estMin}</span>
                  <span className="text-slate-500"> min</span>
                </div>
                <span className="text-slate-300 dark:text-white/20">·</span>
                <div>
                  <span className="font-extrabold text-slate-900 dark:text-white">{count * mk.pos}</span>
                  <span className="text-slate-500"> marks</span>
                </div>
              </div>

              {error && <p className="rounded-2xl bg-rose-500/10 px-4 py-2.5 text-sm font-medium text-rose-500">{error}</p>}
              <div className="space-y-2 pt-1">
                <Button className="w-full" size="lg" onClick={start} disabled={!exam && !topic.trim() && !noteId}>
                  <Swords size={17} /> Start {exam ? `${exam.name} ${mock ? 'mock' : 'quiz'}` : 'quiz'}
                </Button>
                {exam && (
                  <Button variant="soft" className="w-full" onClick={openPlanner}>
                    <CalendarDays size={16} /> Build my {exam.name} study plan
                  </Button>
                )}
              </div>
            </div>
          </GlassCard>
          )}

          <GlassCard className="min-w-0">
            <SectionTitle>Your record</SectionTitle>
            {history.length === 0 ? (
              <Empty emoji="⚔️" text={'No quizzes yet.\nYour scores and streaks will show here.'} />
            ) : (
              <>
                {/* exam readiness ring */}
                <div className="mb-3 flex items-center gap-4 rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-3">
                  <ProgressRing size={64} stroke={8} progress={readiness / 100}
                    color={readiness >= 70 ? '#10b981' : readiness >= 40 ? '#FFB454' : '#f43f5e'} label={`${readiness}`} />
                  <div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">Exam readiness</div>
                    <div className="text-[11px] text-slate-500">accuracy + practice + streak</div>
                  </div>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-2xl bg-white/40 dark:bg-white/5 px-2 py-2.5">
                    <div className="text-lg font-extrabold text-slate-900 dark:text-white">{accuracy}%</div>
                    <div className="text-[10px] text-slate-500">accuracy</div>
                  </div>
                  <div className="rounded-2xl bg-white/40 dark:bg-white/5 px-2 py-2.5">
                    <div className="text-lg font-extrabold text-slate-900 dark:text-white">{totalQ}</div>
                    <div className="text-[10px] text-slate-500">solved</div>
                  </div>
                  <div className="rounded-2xl bg-amber-400/15 px-2 py-2.5">
                    <div className="text-lg font-extrabold text-amber-500">{best}%</div>
                    <div className="text-[10px] text-slate-500">best</div>
                  </div>
                  <div className="rounded-2xl bg-white/40 dark:bg-white/5 px-2 py-2.5">
                    <div className="text-lg font-extrabold text-orange-500">🔥 {streak}</div>
                    <div className="text-[10px] text-slate-500">streak</div>
                  </div>
                  <div className="col-span-2 rounded-2xl bg-white/40 dark:bg-white/5 px-2 py-2.5">
                    <div className="text-lg font-extrabold text-slate-900 dark:text-white">{history.length}</div>
                    <div className="text-[10px] text-slate-500">quizzes taken</div>
                  </div>
                </div>
                {(weakTopic || strongTopic) && (
                  <div className="mb-3 space-y-1.5">
                    {strongTopic && (
                      <div className="flex items-center gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2 text-xs">
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">💪 Strong</span>
                        <span className="truncate text-slate-600 dark:text-slate-300">{strongTopic}</span>
                      </div>
                    )}
                    {weakTopic && weakTopic !== strongTopic && (
                      <div className="flex items-center gap-2 rounded-2xl bg-rose-500/10 px-3 py-2 text-xs">
                        <span className="font-bold text-rose-600 dark:text-rose-400">📌 Weak</span>
                        <span className="truncate text-slate-600 dark:text-slate-300">{weakTopic}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {history.slice(0, 12).map((r) => (
                    <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-white/40 dark:bg-white/5 px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{r.topic}</div>
                        <div className="text-[11px] text-slate-500">{r.difficulty} · {timeAgo(r.created_at)}</div>
                      </div>
                      <div className={cn(
                        'text-sm font-extrabold',
                        r.total && r.score / r.total >= 0.8 ? 'text-emerald-500' : r.total && r.score / r.total >= 0.5 ? 'text-amber-500' : 'text-rose-500',
                      )}>
                        {r.score}/{r.total}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </GlassCard>
        </div>
      )}

      {phase === 'loading' && (
        <GlassCard>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="animate-bounce text-6xl">🦁</div>
            <p className="mt-4 font-bold text-slate-900 dark:text-white">Leo is writing your {exam ? `${exam.name} ` : ''}quiz…</p>
            <p className="mt-1 text-sm text-slate-500">
              {count} {difficulty.toLowerCase()} questions{exam && subject !== 'Mixed' ? ` on ${subject}` : ''} — real exam pattern.
            </p>
          </div>
        </GlassCard>
      )}

      {phase === 'playing' && q && (
        <div className="mx-auto max-w-2xl">
          {/* progress */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-slate-500">
              <span>Question {i + 1} of {questions.length}</span>
              <span className="flex items-center gap-2.5">
                {wasMock && remaining > 0 && (
                  <span className={cn(
                    'flex items-center gap-1 rounded-full px-2 py-0.5',
                    remaining <= 60 ? 'animate-pulse bg-rose-500/15 text-rose-500' : 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
                  )}>
                    <Timer size={12} /> {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
                  </span>
                )}
                <span className="text-emerald-500">{correct} correct</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-purple-500"
                animate={{ width: `${((i + (picked !== null ? 1 : 0)) / questions.length) * 100}%` }}
              />
            </div>
          </div>

          <GlassCard>
            {q.asked && (
              <div className={cn(
                'mb-2.5 inline-block max-w-full rounded-2xl px-3 py-1 text-xs font-bold',
                qsrc === 'repeated'
                  ? 'bg-purple-400/15 text-purple-600 dark:text-purple-300'
                  : 'bg-amber-400/15 text-amber-600 dark:text-amber-300',
              )}>
                {qsrc === 'repeated'
                  ? (q.asked === 'Frequently asked' ? '🔁 Frequently asked (years not on record)' : `🔁 Repeated in ${q.asked}`)
                  : q.asked === 'PYQ-style' ? '📜 PYQ-style question' : `📜 Asked in ${q.asked}`}
              </div>
            )}
            <div className="mb-4 flex items-start gap-2">
              <div className="min-w-0 flex-1 text-base font-bold text-slate-900 dark:text-white sm:text-lg">{q.q}</div>
              <button
                onClick={() => toggleBookmark(q)}
                aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this question'}
                className={cn(
                  'shrink-0 rounded-full p-2 transition active:scale-90',
                  isBookmarked ? 'bg-amber-400/20 text-amber-500' : 'text-slate-400 hover:bg-slate-500/10',
                )}>
                <Bookmark size={18} fill={isBookmarked ? 'currentColor' : 'none'} />
              </button>
            </div>
            <div className="space-y-2.5">
              {q.options.map((opt, idx) => {
                const isAnswer = idx === q.answer
                const isPicked = idx === picked
                return (
                  <button key={idx} onClick={() => pick(idx)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left text-sm font-semibold transition sm:px-4 sm:py-3.5',
                      picked === null
                        ? 'border-slate-200/60 dark:border-white/10 bg-white/50 dark:bg-white/5 text-slate-800 dark:text-slate-100 hover:bg-brand-500/10 hover:border-brand-400/50'
                        : isAnswer
                          ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                          : isPicked
                            ? 'border-rose-400/60 bg-rose-500/15 text-rose-600 dark:text-rose-400'
                            : 'border-slate-200/40 dark:border-white/5 bg-white/30 dark:bg-white/[0.03] text-slate-400 dark:text-slate-500',
                    )}>
                    <span className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold',
                      picked === null ? 'bg-slate-500/10 text-slate-500' :
                        isAnswer ? 'bg-emerald-500 text-white' :
                          isPicked ? 'bg-rose-500 text-white' : 'bg-slate-500/10 text-slate-400',
                    )}>
                      {picked !== null && isAnswer ? <CheckCircle2 size={15} /> : picked !== null && isPicked ? <XCircle size={15} /> : String.fromCharCode(65 + idx)}
                    </span>
                    <span className="min-w-0 flex-1 break-words">{opt}</span>
                  </button>
                )
              })}
            </div>

            {picked !== null && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
                {q.explain && (
                  <p className={cn(
                    'rounded-2xl px-4 py-3 text-sm',
                    picked === q.answer ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-400/10 text-amber-700 dark:text-amber-300',
                  )}>
                    {picked === q.answer ? '✅ ' : '💡 '}{q.explain}
                  </p>
                )}

                {/* on-demand deep-dive from Leo */}
                {detail ? (
                  <div className="mt-2.5 rounded-2xl bg-brand-500/10 px-4 py-3">
                    <div className="mb-1 flex items-center justify-between">
                      <div className="text-xs font-bold uppercase tracking-wide text-brand-500">🦁 Leo explains</div>
                      <button
                        onClick={() => (voice.isPlaying ? voice.pause() : voice.play(detail))}
                        aria-label="Read explanation aloud"
                        className="flex items-center gap-1 rounded-full bg-brand-500/15 px-2.5 py-1 text-xs font-bold text-brand-600 transition hover:bg-brand-500/25 dark:text-brand-300">
                        {voice.isPlaying ? <Pause size={13} /> : <Volume2 size={13} />}
                        {voice.isPlaying ? 'Pause' : 'Listen'}
                      </button>
                    </div>
                    <p className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-200">{detail}</p>
                    {voice.noVoice && <p className="mt-1.5 text-[11px] text-amber-500">Install a voice for this language in your device Text-to-speech settings to hear it.</p>}
                  </div>
                ) : (
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <Button variant="ghost" size="sm" onClick={explainMore} disabled={detailLoading}>
                      {detailLoading ? '🦁 …' : '🔍 Explain'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={teachThis}>
                      <GraduationCap size={15} /> Teach topic
                    </Button>
                  </div>
                )}

                <Button className="mt-3 w-full" size="lg" onClick={next}>
                  {i + 1 < questions.length ? 'Next question' : 'See my score'}
                </Button>
              </motion.div>
            )}
          </GlassCard>
        </div>
      )}

      {phase === 'done' && (
        <div className="mx-auto max-w-md">
          <GlassCard className="text-center">
            <div className="text-5xl">{pct >= 80 ? '🏆' : pct >= 50 ? '💪' : '📚'}</div>
            <div className="mt-3 flex justify-center">
              <ProgressRing size={120} stroke={12} progress={pct / 100}
                color={pct >= 80 ? '#10b981' : pct >= 50 ? '#FFB454' : '#f43f5e'}
                label={`${pct}%`} sub={`${correct}/${questions.length}`} />
            </div>
            <h2 className="mt-4 text-xl font-extrabold text-slate-900 dark:text-white">
              {pct === 100 ? 'Perfect score! Absolute lion. 🦁' : pct >= 80 ? 'Roaring good! 🦁' : pct >= 50 ? 'Solid effort — keep going!' : 'Every wrong answer teaches you one thing.'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{playedTopic} · {difficulty}</p>
            {wasMock && (
              <div className="mx-auto mt-3 max-w-xs rounded-2xl bg-slate-500/10 px-4 py-2.5">
                <div className="text-lg font-extrabold text-slate-900 dark:text-white">
                  {(Math.round((correct * mk.pos - (wasNeg ? wrongCnt * mk.neg : 0)) * 100) / 100).toFixed(2)} / {questions.length * mk.pos} marks
                </div>
                <div className="text-[11px] text-slate-500">
                  +{mk.pos} × {correct} correct{wasNeg && mk.neg > 0 ? ` · −${fracGlyph(mk.neg)} × ${wrongCnt} wrong` : ` · ${wrongCnt} wrong (no penalty)`}{questions.length - correct - wrongCnt > 0 ? ` · ${questions.length - correct - wrongCnt} unanswered` : ''}
                </div>
              </div>
            )}
            {earned > 0 && (
              <div className="mx-auto mt-3 inline-block rounded-full bg-amber-400/15 px-4 py-1.5 text-sm font-bold text-amber-500">
                ⭐ +{earned} XP earned
              </div>
            )}
            {wrongCnt > 0 && (
              <Button variant="soft" className="mt-4 w-full" onClick={drillMistakes} disabled={drilling}>
                <Target size={15} /> {drilling ? 'Building drill…' : `Drill my ${wrongCnt} mistake${wrongCnt > 1 ? 's' : ''} with AI`}
              </Button>
            )}
            <div className="mt-3 flex gap-3">
              <Button variant="soft" className="flex-1" onClick={() => { setPhase('setup'); setStage('pick'); setTopic('') }}>
                <Sparkles size={15} /> New quiz
              </Button>
              <Button className="flex-1" onClick={start}>
                <RotateCw size={15} /> Retry topic
              </Button>
            </div>
          </GlassCard>
        </div>
      )}

      {/* ---- AI exam study planner ---- */}
      <Modal open={planOpen} onClose={() => setPlanOpen(false)} title={`📅 ${exam?.name ?? ''} study plan`} wide>
        {planLoading ? (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="animate-bounce text-5xl">🦁</div>
            <p className="mt-3 font-bold text-slate-900 dark:text-white">Building your {exam?.name} roadmap…</p>
            <p className="mt-1 text-sm text-slate-500">Syllabus phases, daily routine, mock calendar.</p>
          </div>
        ) : plan ? (
          <div className="space-y-3">
            {plan.summary && (
              <p className="rounded-2xl bg-brand-500/10 px-4 py-3 text-sm font-medium text-brand-600 dark:text-brand-300">{plan.summary}</p>
            )}
            <div className="space-y-2">
              {plan.phases.map((p, idx) => (
                <div key={idx} className="rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-3">
                  <div className="text-sm font-bold text-slate-900 dark:text-white">{idx + 1}. {p.title}</div>
                  <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{p.detail}</div>
                </div>
              ))}
            </div>
            {plan.dailyRoutine.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Your daily routine</div>
                <div className="space-y-1.5">
                  {plan.dailyRoutine.map((r, idx) => (
                    <p key={idx} className="rounded-2xl bg-emerald-500/10 px-3.5 py-2 text-sm text-emerald-700 dark:text-emerald-300">• {r}</p>
                  ))}
                </div>
              </div>
            )}
            {plan.mockSchedule && (
              <p className="rounded-2xl bg-rose-500/10 px-4 py-2.5 text-sm font-medium text-rose-600 dark:text-rose-400">⏱️ Mocks: {plan.mockSchedule}</p>
            )}
            {plan.tips.length > 0 && (
              <div className="space-y-1.5">
                {plan.tips.map((t, idx) => (
                  <p key={idx} className="rounded-2xl bg-amber-400/10 px-3.5 py-2 text-sm text-amber-700 dark:text-amber-300">💡 {t}</p>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setPlan(null)}><RotateCw size={15} /> New plan</Button>
              <Button className="flex-1" onClick={() => setPlanOpen(false)}>Done — let's study 🦁</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Exam date</div>
              <Input type="date" value={planDate} min={todayKey()} onChange={(e) => setPlanDate(e.target.value)} />
            </div>
            <div>
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Study hours per day</div>
              <div className="grid grid-cols-4 gap-2">
                {[2, 4, 6, 8].map((h) => (
                  <button key={h} onClick={() => setPlanHours(h)}
                    className={cn(
                      'rounded-2xl px-3 py-2.5 text-sm font-bold transition',
                      planHours === h ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
                    )}>
                    {h}h
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Current level</div>
              <div className="grid grid-cols-3 gap-2">
                {['Beginner', 'Intermediate', 'Advanced'].map((l) => (
                  <button key={l} onClick={() => setPlanLevel(l)}
                    className={cn(
                      'rounded-2xl px-2 py-2.5 text-xs font-bold transition sm:text-sm',
                      planLevel === l ? 'bg-gradient-to-r from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'glass text-slate-600 dark:text-slate-300',
                    )}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {planError && <p className="rounded-2xl bg-rose-500/10 px-4 py-2.5 text-sm font-medium text-rose-500">{planError}</p>}
            <Button className="w-full" size="lg" onClick={makePlan} disabled={!planDate}>
              <Sparkles size={16} /> Build my plan
            </Button>
          </div>
        )}
      </Modal>

      {/* ---- teach-this-topic lesson ---- */}
      <Modal open={teachOpen} onClose={() => { setTeachOpen(false); voice.stop() }} title="🦁 Leo teaches this topic" wide>
        {teachLoading ? (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="animate-bounce text-5xl">🦁</div>
            <p className="mt-3 font-bold text-slate-900 dark:text-white">Preparing your lesson…</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button variant="soft" size="sm" onClick={() => (voice.isPlaying ? voice.pause() : voice.play(teachText))}>
                {voice.isPlaying ? <><Pause size={14} /> Pause</> : <><Volume2 size={14} /> Listen</>}
              </Button>
            </div>
            <p className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-200">{teachText}</p>
            {voice.noVoice && <p className="text-[11px] text-amber-500">Install a voice for this language in your device Text-to-speech settings to hear it.</p>}
          </div>
        )}
      </Modal>
    </Page>
  )
}
