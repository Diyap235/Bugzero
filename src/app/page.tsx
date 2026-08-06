"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck, ArrowRight, Sparkles, Zap, Lock, Code2, FileCheck,
  BarChart3, CheckCircle2, XCircle, HelpCircle, Github, ChevronDown,
  AlertTriangle, Shield, GitBranch, Terminal, Play, Cpu, TrendingUp,
  FileCode2, FolderOpen, Circle, Minus, Square,
} from "lucide-react";
import {
  motion, useScroll, useTransform, useInView, AnimatePresence,
} from "framer-motion";

// ─── Animation helpers ────────────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

const stagger = (delay = 0.1) => ({
  hidden: {},
  show: { transition: { staggerChildren: delay } },
});

function FadeIn({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── VS Code Workspace Mock ───────────────────────────────────────────────────
const CODE_LINES = [
  { n: 1,  text: "from app.db import get_connection",         type: "import" },
  { n: 2,  text: "from app.models import User",              type: "import" },
  { n: 3,  text: "",                                          type: "blank" },
  { n: 4,  text: "def get_user_by_email(email: str):",       type: "def" },
  { n: 5,  text: '    """Fetch user record by email."""',    type: "doc" },
  { n: 6,  text: "    conn = get_connection()",              type: "code" },
  { n: 7,  text: "    cursor = conn.cursor()",               type: "code" },
  { n: 8,  text: "    # CRITICAL: SQL Injection (B608)",     type: "critical-comment" },
  { n: 9,  text: `    query = f"SELECT * FROM users`,         type: "danger" },
  { n: 10, text: `      WHERE email = '{email}'"`,            type: "danger" },
  { n: 11, text: "    cursor.execute(query)",                 type: "danger" },
  { n: 12, text: "    return cursor.fetchone()",              type: "code" },
];

const LINE_COLORS: Record<string, string> = {
  import: "text-info",
  def: "text-primary",
  doc: "text-text-muted",
  code: "text-text-secondary",
  "critical-comment": "text-danger font-bold",
  danger: "text-danger/90",
  blank: "",
};

function VSCodeWorkspace() {
  const [visibleLines, setVisibleLines] = useState(0);
  const [findingVisible, setFindingVisible] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  useEffect(() => {
    if (!inView) return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setVisibleLines(i);
      if (i === CODE_LINES.length) {
        clearInterval(interval);
        setTimeout(() => setFindingVisible(true), 300);
        setTimeout(() => setPanelVisible(true), 700);
      }
    }, 90);
    return () => clearInterval(interval);
  }, [inView]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: 40 }}
      animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full bg-[#0B120F] border border-[#1E3025] rounded-2xl overflow-hidden shadow-2xl"
      style={{ minHeight: 480 }}
    >
      {/* Title Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#050705] border-b border-[#1E3025]">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#EF4444]/70" />
          <span className="w-3 h-3 rounded-full bg-[#F59E0B]/70" />
          <span className="w-3 h-3 rounded-full bg-[#4CAF50]/70" />
        </div>
        <span className="text-[11px] text-[#7E8A84] font-mono">BugZero — auth-service-python</span>
        <div className="flex items-center gap-1 text-[#7E8A84]">
          <Minus className="w-3 h-3" /><Square className="w-3 h-3" />
        </div>
      </div>

      <div className="flex h-full" style={{ minHeight: 440 }}>
        {/* Activity Bar */}
        <div className="w-10 bg-[#050705] border-r border-[#1E3025] flex flex-col items-center py-3 gap-4">
          {[FileCode2, GitBranch, Shield, Terminal].map((Icon, i) => (
            <Icon key={i} className={`w-4 h-4 ${i === 0 ? "text-[#2E7D32]" : "text-[#7E8A84]"}`} />
          ))}
        </div>

        {/* Sidebar File Explorer */}
        <div className="w-36 bg-[#0B120F] border-r border-[#1E3025] p-2 shrink-0">
          <div className="text-[10px] text-[#7E8A84] font-semibold uppercase tracking-widest px-1 mb-2">
            Explorer
          </div>
          {[
            { name: "auth-service", children: ["user_repo.py", "config.py", "auth.py"] },
          ].map((folder) => (
            <div key={folder.name}>
              <div className="flex items-center gap-1 text-[11px] text-[#AAB5AF] px-1 py-0.5">
                <FolderOpen className="w-3 h-3 text-[#F59E0B]" />
                <span>{folder.name}</span>
              </div>
              {folder.children.map((f) => (
                <div
                  key={f}
                  className={`flex items-center gap-1 text-[11px] px-3 py-0.5 rounded cursor-pointer ${
                    f === "user_repo.py"
                      ? "bg-[#1E3025] text-white font-medium"
                      : "text-[#7E8A84] hover:text-[#AAB5AF]"
                  }`}
                >
                  <FileCode2 className="w-3 h-3 shrink-0" />
                  <span className="truncate">{f}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Editor area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tabs */}
          <div className="flex items-center border-b border-[#1E3025] bg-[#050705]">
            {["user_repo.py", "config.py"].map((tab, i) => (
              <div
                key={tab}
                className={`flex items-center gap-1.5 px-3 py-2 text-[11px] border-r border-[#1E3025] ${
                  i === 0
                    ? "bg-[#0B120F] text-white border-t-2 border-t-[#2E7D32]"
                    : "text-[#7E8A84]"
                }`}
              >
                <FileCode2 className="w-3 h-3" />
                {tab}
                {i === 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" title="Has findings" />
                )}
              </div>
            ))}
          </div>

          {/* Code lines */}
          <div className="flex-1 p-3 font-mono text-[11px] leading-5 overflow-hidden">
            {CODE_LINES.slice(0, visibleLines).map((line, i) => (
              <motion.div
                key={line.n}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
                className={`flex items-start gap-3 ${
                  (line.type === "danger" || line.type === "critical-comment") && findingVisible
                    ? "bg-[#EF4444]/10 rounded"
                    : ""
                }`}
              >
                <span className="text-[#7E8A84]/50 select-none w-4 text-right shrink-0">
                  {line.n}
                </span>
                <span className={LINE_COLORS[line.type] ?? "text-[#AAB5AF]"}>
                  {line.text}
                </span>
              </motion.div>
            ))}
          </div>

          {/* Bottom Terminal */}
          <div className="border-t border-[#1E3025] bg-[#050705] p-2 font-mono text-[10px]">
            <div className="text-[#7E8A84] flex items-center gap-2">
              <Terminal className="w-3 h-3" />
              <span className="text-[#2E7D32] font-bold">BugZero</span>
              <span className="text-[#7E8A84]">▸ Bandit B608: SQL injection detected — line 9 (confidence: HIGH)</span>
            </div>
          </div>
        </div>

        {/* Right AI Panel */}
        <AnimatePresence>
          {panelVisible && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 176 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="border-l border-[#1E3025] bg-[#0B120F] p-3 overflow-hidden shrink-0"
              style={{ width: 176 }}
            >
              <div className="text-[10px] text-[#2E7D32] font-bold uppercase tracking-widest mb-2 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> AI Review
              </div>
              <div className="space-y-2">
                <div className="bg-[#EF4444]/15 border border-[#EF4444]/30 rounded p-2 text-[10px]">
                  <div className="text-[#EF4444] font-bold">CRITICAL</div>
                  <div className="text-[#AAB5AF] mt-0.5">SQL Injection</div>
                  <div className="text-[#7E8A84] mt-0.5 font-mono">AI 96%</div>
                </div>
                <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded p-2 text-[10px]">
                  <div className="text-[#F59E0B] font-bold">HIGH</div>
                  <div className="text-[#AAB5AF] mt-0.5">Hardcoded key</div>
                  <div className="text-[#7E8A84] mt-0.5 font-mono">AI 91%</div>
                </div>
                <div className="mt-2 pt-2 border-t border-[#1E3025] text-[10px] text-[#7E8A84]">
                  Health
                  <div className="text-[#4CAF50] font-bold font-mono text-base">84%</div>
                  <div className="w-full bg-[#1E3025] h-1.5 rounded-full mt-1">
                    <div className="bg-[#4CAF50] h-full rounded-full" style={{ width: "84%" }} />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Inline finding overlay */}
      <AnimatePresence>
        {findingVisible && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute left-[190px] top-[225px] z-20 bg-[#101915] border border-[#EF4444]/50 rounded-lg shadow-xl p-2.5 max-w-[260px]"
          >
            <div className="flex items-center gap-1.5 text-[#EF4444] text-[11px] font-bold mb-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              SQL Injection (Bandit B608)
            </div>
            <div className="text-[10px] text-[#AAB5AF]">
              String interpolation into raw SQL. Use parameterized queries.
            </div>
            <div className="mt-1.5 font-mono text-[10px] space-y-0.5">
              <div className="text-[#EF4444] bg-[#EF4444]/10 px-1.5 py-0.5 rounded">
                - f&quot;...WHERE email = &#39;{"{email}"}&#39;&quot;
              </div>
              <div className="text-[#4CAF50] bg-[#4CAF50]/10 px-1.5 py-0.5 rounded">
                + &quot;...WHERE email = %s&quot;, (email,)
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Scrolling counter ────────────────────────────────────────────────────────
function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const step = to / 40;
    const timer = setInterval(() => {
      start += step;
      if (start >= to) { setCount(to); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 30);
    return () => clearInterval(timer);
  }, [inView, to]);

  return <span ref={ref}>{count}{suffix}</span>;
}

// ─── Section wrapper with fade-up ────────────────────────────────────────────
function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.section
      id={id}
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

// ─── FAQ Item ─────────────────────────────────────────────────────────────────
function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[#1E3025] rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-[#16211B] transition-colors"
      >
        <span className="text-sm font-semibold text-white">{q}</span>
        <ChevronDown
          className={`w-4 h-4 text-[#7E8A84] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <p className="px-6 pb-4 text-sm text-[#AAB5AF] leading-relaxed">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { scrollY } = useScroll();
  const navBg = useTransform(scrollY, [0, 80], ["rgba(5,7,5,0)", "rgba(11,18,15,0.97)"]);
  const navBorder = useTransform(scrollY, [0, 80], ["rgba(30,48,37,0)", "rgba(30,48,37,1)"]);

  return (
    <div className="min-h-screen bg-[#050705] text-white overflow-x-hidden">

      {/* ── Background depth ── */}
      <div className="fixed inset-0 pointer-events-none">
        {/* Grid */}
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(#1E3025 1px, transparent 1px), linear-gradient(90deg, #1E3025 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
        {/* Radial light — top center */}
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full opacity-[0.12]"
          style={{ background: "radial-gradient(ellipse, #2E7D32 0%, transparent 70%)" }}
        />
      </div>

      {/* ── Sticky Navbar ── */}
      <motion.header
        style={{ backgroundColor: navBg, borderBottomColor: navBorder }}
        className="fixed top-0 left-0 right-0 z-50 h-[72px] border-b flex items-center px-6 md:px-10"
      >
        <div className="max-w-[1440px] w-full mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#2E7D32]/20 border border-[#2E7D32]/40 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-[#2E7D32]" />
            </div>
            <span className="text-lg font-bold tracking-wider">
              BUG<span className="text-[#2E7D32]">ZERO</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-[13px] font-medium text-[#AAB5AF]">
            {[["#features","Features"],["#pipeline","How It Works"],["#showcase","Product"],["#tech-stack","Tech Stack"],["#faq","FAQ"]].map(([href,label]) => (
              <a key={href} href={href} className="hover:text-white transition-colors duration-150">{label}</a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden sm:inline-flex items-center h-9 px-4 text-sm font-medium text-[#AAB5AF] hover:text-white transition-colors rounded-xl">
              Sign In
            </Link>
            <Link href="/repositories">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-2 h-9 px-5 bg-[#2E7D32] hover:bg-[#388E3C] text-white text-sm font-semibold rounded-xl transition-colors"
              >
                Start Reviewing <ArrowRight className="w-3.5 h-3.5" />
              </motion.button>
            </Link>
          </div>
        </div>
      </motion.header>

      {/* ════════════════════════════════════════════════
          HERO — full viewport height
      ════════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex items-center pt-[72px]">
        <div className="max-w-[1440px] w-full mx-auto px-6 md:px-10 py-16 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          {/* Left copy */}
          <motion.div
            variants={stagger(0.1)}
            initial="hidden"
            animate="show"
            className="space-y-8 relative z-10"
          >
            {/* Badge */}
            <motion.div variants={fadeUp}>
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-semibold bg-[#2E7D32]/15 text-[#4CAF50] border border-[#2E7D32]/35">
                <Sparkles className="w-3.5 h-3.5" />
                Explainable AI · Evidence-First · CodeBERT + Pylint + Bandit
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              variants={fadeUp}
              className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05] text-white"
            >
              Ship Safer Code<br />
              with{" "}
              <span className="text-[#2E7D32]">Explainable AI</span>{" "}
              Reviews
            </motion.h1>

            {/* Subtitle */}
            <motion.p variants={fadeUp} className="text-[16px] text-[#AAB5AF] leading-relaxed max-w-[480px]">
              Transform source code into actionable engineering decisions. Powered by static analysis,
              CodeBERT ML classification, and root-cause patch diffs — with full evidence before AI speaks.
            </motion.p>

            {/* CTAs */}
            <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-4">
              <Link href="/repositories">
                <motion.button
                  whileHover={{ scale: 1.03, boxShadow: "0 0 32px rgba(46,125,50,0.35)" }}
                  whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-2.5 h-14 px-8 bg-[#2E7D32] hover:bg-[#388E3C] text-white text-[15px] font-bold rounded-xl transition-all"
                >
                  <Play className="w-4 h-4" />
                  Start Reviewing
                </motion.button>
              </Link>
              <Link href="/repositories/repo-1">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-2.5 h-14 px-8 border border-[#1E3025] hover:border-[#294134] hover:bg-[#16211B] text-white text-[15px] font-semibold rounded-xl transition-all"
                >
                  View Live Demo
                </motion.button>
              </Link>
            </motion.div>

            {/* Trust indicators */}
            <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-5 pt-2 text-[13px] text-[#7E8A84]">
              {[
                { icon: ShieldCheck, text: "Evidence-first analysis" },
                { icon: Cpu, text: "CodeBERT ML scoring" },
                { icon: TrendingUp, text: "Repository health tracking" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 text-[#2E7D32]" />
                  <span>{text}</span>
                </div>
              ))}
            </motion.div>
          </motion.div>

          {/* Right — VS Code workspace */}
          <div className="relative z-10">
            <VSCodeWorkspace />
          </div>
        </div>

        {/* Scroll hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.5, duration: 0.8 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-[#7E8A84]"
        >
          <span className="text-[11px] uppercase tracking-widest">Scroll to explore</span>
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <ChevronDown className="w-4 h-4" />
          </motion.div>
        </motion.div>
      </section>

      {/* ════════════════════════════════════════════════
          TRUST BADGES
      ════════════════════════════════════════════════ */}
      <Section className="border-y border-[#1E3025] bg-[#0B120F]/60 py-8">
        <div className="max-w-[1440px] mx-auto px-6 md:px-10">
          <div className="flex flex-wrap items-center justify-center gap-2 mb-5">
            <span className="text-[11px] font-semibold text-[#7E8A84] uppercase tracking-widest">
              Built for production engineering teams
            </span>
          </div>
          <motion.div
            variants={stagger(0.06)}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="flex flex-wrap items-center justify-center gap-3"
          >
            {["Security Analysis","Risk Scoring","Code Quality","Health Tracking","Audit Reports","Code Diffs","Finding Management","Repository Overview"].map((t) => (
              <motion.span
                key={t}
                variants={fadeUp}
                className="px-4 py-2 bg-[#101915] border border-[#1E3025] rounded-xl text-[12px] text-[#AAB5AF] hover:border-[#2E7D32]/50 hover:text-white transition-colors"
              >
                {t}
              </motion.span>
            ))}
          </motion.div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          PROBLEM SECTION — alternating split layout
      ════════════════════════════════════════════════ */}
      <Section className="py-28 px-6 md:px-10">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4 max-w-2xl mx-auto">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">The Problem</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
              Code reviews are slow.<br />Bugs found later cost more.
            </h2>
            <p className="text-[15px] text-[#AAB5AF]">
              Traditional manual reviews miss subtle security bugs and leave teams with inconsistent quality standards.
            </p>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              {
                icon: Lock, color: "text-[#EF4444]", glow: "bg-[#EF4444]/5 border-[#EF4444]/20",
                title: "Hidden Security Vulnerabilities",
                body: "Raw SQL injections, unhashed passwords, and hardcoded API tokens bypass surface-level human reviews entirely.",
              },
              {
                icon: Zap, color: "text-[#F59E0B]", glow: "bg-[#F59E0B]/5 border-[#F59E0B]/20",
                title: "Inconsistent Quality Standards",
                body: "Every reviewer evaluates code differently, leading to code rot, technical debt, and unmaintainable modules.",
              },
              {
                icon: Code2, color: "text-[#3B82F6]", glow: "bg-[#3B82F6]/5 border-[#3B82F6]/20",
                title: "Black-Box AI Hallucinations",
                body: "Generic LLM chatbots suggest fixes without static analysis evidence or ML confidence scoring behind them.",
              },
              {
                icon: BarChart3, color: "text-[#2E7D32]", glow: "bg-[#2E7D32]/5 border-[#2E7D32]/20",
                title: "No Repository Health Metrics",
                body: "Teams lack longitudinal visibility into code quality, security trends, and weak module hotspots over time.",
              },
            ].map((card, i) => {
              const Icon = card.icon;
              return (
                <FadeIn key={card.title} delay={i * 0.08}>
                  <motion.div
                    whileHover={{ y: -4 }}
                    transition={{ duration: 0.2 }}
                    className={`p-6 border rounded-2xl space-y-3 h-full ${card.glow} hover:border-[#294134] transition-colors`}
                  >
                    <div className={`w-10 h-10 rounded-xl border ${card.glow} flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${card.color}`} />
                    </div>
                    <h3 className="text-lg font-bold">{card.title}</h3>
                    <p className="text-[14px] text-[#AAB5AF] leading-relaxed">{card.body}</p>
                  </motion.div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          AI PIPELINE — connected horizontal flow
      ════════════════════════════════════════════════ */}
      <Section id="pipeline" className="py-28 px-6 md:px-10 bg-[#0B120F] border-y border-[#1E3025]">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">Evidence Before AI</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">The BugZero AI Review Pipeline</h2>
            <p className="text-[15px] text-[#AAB5AF] max-w-xl mx-auto">
              Static analysis runs before AI — every finding is backed by machine-verifiable evidence, not guesswork.
            </p>
          </FadeIn>

          <div className="relative">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-8 left-[10%] right-[10%] h-[2px] bg-gradient-to-r from-transparent via-[#2E7D32]/40 to-transparent" />

            <motion.div
              variants={stagger(0.12)}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-60px" }}
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 relative"
            >
              {[
                { step: "01", title: "Repository Upload", desc: "Source file or archive ingestion up to 50MB", icon: FolderOpen, color: "text-[#3B82F6]" },
                { step: "02", title: "Static Analysis", desc: "Pylint quality scan + Bandit security scan", icon: Shield, color: "text-[#F59E0B]" },
                { step: "03", title: "CodeBERT ML", desc: "Semantic classification with 0–100% confidence", icon: Cpu, color: "text-[#2E7D32]" },
                { step: "04", title: "Explainable AI", desc: "LLM root-cause analysis and patch generation", icon: Sparkles, color: "text-[#AAB5AF]" },
                { step: "05", title: "Actionable Report", desc: "Code diffs, health trends, PDF/JSON export", icon: FileCheck, color: "text-[#4CAF50]" },
              ].map((p, i) => {
                const Icon = p.icon;
                return (
                  <motion.div
                    key={p.step}
                    variants={fadeUp}
                    className="relative bg-[#101915] border border-[#1E3025] rounded-2xl p-5 space-y-3 hover:border-[#2E7D32]/50 transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-[#7E8A84]">{p.step}</span>
                      <Icon className={`w-4 h-4 ${p.color} group-hover:scale-110 transition-transform`} />
                    </div>
                    <h4 className="text-[14px] font-bold">{p.title}</h4>
                    <p className="text-[12px] text-[#7E8A84] leading-relaxed">{p.desc}</p>
                    {i < 4 && (
                      <div className="hidden md:block absolute -right-3 top-8 z-10 w-6 h-6 rounded-full bg-[#0B120F] border border-[#2E7D32]/30 flex items-center justify-center">
                        <ArrowRight className="w-3 h-3 text-[#2E7D32]" />
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          INTERACTIVE PRODUCT SHOWCASE — bento grid
      ════════════════════════════════════════════════ */}
      <Section id="showcase" className="py-28 px-6 md:px-10">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">Product Preview</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Everything you need, nothing you don&apos;t</h2>
          </FadeIn>

          {/* Bento grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 auto-rows-auto">

            {/* Big: Repository Health */}
            <FadeIn className="md:col-span-2" delay={0}>
              <motion.div
                whileHover={{ y: -3 }}
                className="bg-[#101915] border border-[#1E3025] rounded-2xl p-6 space-y-4 h-full hover:border-[#294134] transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-1">Repository Health</p>
                    <h3 className="text-lg font-bold">auth-service-python</h3>
                  </div>
                  <span className="px-3 py-1 bg-[#4CAF50]/15 border border-[#4CAF50]/30 text-[#4CAF50] text-[12px] font-mono font-bold rounded-full">
                    84 / 100
                  </span>
                </div>
                {/* Inline mini chart */}
                <div className="flex items-end gap-1 h-16">
                  {[72, 75, 79, 81, 83, 84].map((v, i) => (
                    <motion.div
                      key={i}
                      initial={{ height: 0 }}
                      whileInView={{ height: `${(v / 100) * 64}px` }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.07, duration: 0.4, ease: "easeOut" }}
                      className="flex-1 rounded-t bg-[#2E7D32]/50 hover:bg-[#2E7D32] transition-colors"
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-[#7E8A84] font-mono">
                  {["Jul 5","Jul 12","Jul 19","Jul 26","Aug 2","Aug 3"].map((d) => <span key={d}>{d}</span>)}
                </div>
                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-[#1E3025]">
                  {[["Pylint Quality","88%","text-[#3B82F6]"],["Bandit Security","78%","text-[#F59E0B]"],["Open Findings","4","text-[#EF4444]"]].map(([l,v,c]) => (
                    <div key={l} className="bg-[#0B120F] rounded-xl p-3">
                      <span className="text-[10px] text-[#7E8A84] block">{l}</span>
                      <span className={`text-lg font-bold font-mono ${c}`}>{v}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </FadeIn>

            {/* Tall: AI Finding Card */}
            <FadeIn delay={0.1}>
              <motion.div
                whileHover={{ y: -3 }}
                className="bg-[#101915] border border-[#EF4444]/25 rounded-2xl p-5 space-y-4 hover:border-[#EF4444]/50 transition-colors h-full"
              >
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 bg-[#EF4444]/15 border border-[#EF4444]/30 text-[#EF4444] text-[11px] font-bold rounded-full uppercase">Critical</span>
                  <span className="text-[11px] font-mono text-[#7E8A84]">AI 96%</span>
                </div>
                <div>
                  <h4 className="text-[14px] font-bold">SQL Injection Risk</h4>
                  <p className="text-[11px] text-[#7E8A84] font-mono mt-1">user_repo.py:48 · Bandit B608</p>
                </div>
                <div className="bg-[#050705] rounded-xl p-3 font-mono text-[11px] space-y-1 border border-[#1E3025]">
                  <div className="text-[#EF4444]/90 bg-[#EF4444]/10 px-2 py-1 rounded">
                    - f&quot;...WHERE email=&apos;{"{email}"}&apos;&quot;
                  </div>
                  <div className="text-[#4CAF50] bg-[#4CAF50]/10 px-2 py-1 rounded">
                    + &quot;...WHERE email=%s&quot;, (email,)
                  </div>
                </div>
                <div className="bg-[#0B120F] border border-[#1E3025] rounded-xl p-3 text-[11px] text-[#AAB5AF] space-y-1">
                  <p className="font-semibold text-white text-[12px]">Root Cause</p>
                  <p>String interpolation into raw SQL allows malicious actors to inject arbitrary queries (CWE-89).</p>
                </div>
                <div className="pt-2">
                  <div className="w-full bg-[#0B120F] rounded-full h-1.5 border border-[#1E3025]">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: "96%" }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.7, ease: "easeOut" }}
                      className="bg-[#EF4444] h-full rounded-full"
                    />
                  </div>
                  <p className="text-[10px] text-[#7E8A84] mt-1 font-mono">CodeBERT confidence: 96%</p>
                </div>
              </motion.div>
            </FadeIn>

            {/* Wide: Code diff viewer */}
            <FadeIn className="md:col-span-2" delay={0.15}>
              <motion.div
                whileHover={{ y: -3 }}
                className="bg-[#101915] border border-[#1E3025] rounded-2xl overflow-hidden hover:border-[#294134] transition-colors h-full"
              >
                <div className="px-5 py-3 bg-[#0B120F] border-b border-[#1E3025] flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-[#AAB5AF]">
                    <FileCode2 className="w-3.5 h-3.5 text-[#2E7D32]" />
                    Suggested Fix — app/core/config.py
                  </div>
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="text-[#EF4444]">- 1 line</span>
                    <span className="text-[#4CAF50]">+ 4 lines</span>
                  </div>
                </div>
                <div className="p-5 font-mono text-[12px] space-y-1.5">
                  {[
                    { t: "remove", c: '- JWT_SECRET_KEY = "super_secret_production_key_12345!"' },
                    { t: "add",    c: "+ import os" },
                    { t: "add",    c: '+ JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")' },
                    { t: "add",    c: "+ if not JWT_SECRET_KEY:" },
                    { t: "add",    c: '+     raise ValueError("JWT_SECRET_KEY is missing")' },
                    { t: "neutral",c: "  " },
                    { t: "neutral",c: "  # Always load secrets from environment variables or" },
                    { t: "neutral",c: "  # a secure vault (e.g., AWS Secrets Manager)" },
                  ].map((l, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.06, duration: 0.25 }}
                      className={`px-3 py-0.5 rounded ${
                        l.t === "remove" ? "bg-[#EF4444]/10 text-[#EF4444]" :
                        l.t === "add" ? "bg-[#4CAF50]/10 text-[#4CAF50]" :
                        "text-[#7E8A84]"
                      }`}
                    >
                      {l.c}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </FadeIn>

            {/* Small: Weak modules */}
            <FadeIn delay={0.2}>
              <motion.div
                whileHover={{ y: -3 }}
                className="bg-[#101915] border border-[#1E3025] rounded-2xl p-5 space-y-4 hover:border-[#294134] transition-colors h-full"
              >
                <p className="text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider">Weak Modules</p>
                <div className="space-y-3">
                  {[
                    { file: "user_repo.py", health: 62, risk: "High" },
                    { file: "config.py", health: 74, risk: "Medium" },
                    { file: "error_handler.py", health: 81, risk: "Medium" },
                  ].map((m) => (
                    <div key={m.file} className="space-y-1">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="font-mono text-[#AAB5AF] truncate">{m.file}</span>
                        <span className={`font-mono font-bold ${m.health < 70 ? "text-[#EF4444]" : "text-[#F59E0B]"}`}>
                          {m.health}%
                        </span>
                      </div>
                      <div className="w-full bg-[#0B120F] rounded-full h-1.5">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: `${m.health}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.6, ease: "easeOut" }}
                          className={`h-full rounded-full ${m.health < 70 ? "bg-[#EF4444]" : "bg-[#F59E0B]"}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </FadeIn>
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          FEATURES — 3x2 grid with icon + hover border
      ════════════════════════════════════════════════ */}
      <Section id="features" className="py-28 px-6 md:px-10 bg-[#0B120F] border-y border-[#1E3025]">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">Features</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
              Everything you need for repository quality
            </h2>
          </FadeIn>

          <motion.div
            variants={stagger(0.07)}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            className="grid grid-cols-1 md:grid-cols-3 gap-5"
          >
            {[
              { icon: ShieldCheck, color: "text-[#2E7D32]", bg: "bg-[#2E7D32]/10 border-[#2E7D32]/20",
                title: "Static Analysis First",
                body: "Pylint and Bandit always run before AI speaks — every finding has machine-verifiable evidence attached." },
              { icon: Sparkles, color: "text-[#AAB5AF]", bg: "bg-[#AAB5AF]/5 border-[#AAB5AF]/15",
                title: "CodeBERT ML Scoring",
                body: "Fine-tuned CodeBERT assigns 0–100% confidence scores, eliminating vague AI guesses." },
              { icon: Code2, color: "text-[#3B82F6]", bg: "bg-[#3B82F6]/10 border-[#3B82F6]/20",
                title: "Actionable Code Diffs",
                body: "Interactive patch previews with before/after context, ready to copy straight into your IDE." },
              { icon: BarChart3, color: "text-[#4CAF50]", bg: "bg-[#4CAF50]/10 border-[#4CAF50]/20",
                title: "Repository Health Score",
                body: "Track quality, security, and technical debt trends over every review with longitudinal charts." },
              { icon: FileCheck, color: "text-[#F59E0B]", bg: "bg-[#F59E0B]/10 border-[#F59E0B]/20",
                title: "Exportable Audit Reports",
                body: "Download professional PDF and JSON review summaries for compliance, handoffs, and audits." },
              { icon: Lock, color: "text-[#EF4444]", bg: "bg-[#EF4444]/10 border-[#EF4444]/20",
                title: "Zero Data Retraining",
                body: "Your source code is analyzed securely and never used to retrain any ML models." },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.title}
                  variants={fadeUp}
                  whileHover={{ y: -4, borderColor: "#294134" }}
                  className="bg-[#101915] border border-[#1E3025] rounded-2xl p-6 space-y-4 transition-all cursor-default"
                >
                  <div className={`w-10 h-10 border rounded-xl flex items-center justify-center ${f.bg}`}>
                    <Icon className={`w-5 h-5 ${f.color}`} />
                  </div>
                  <h3 className="text-[16px] font-bold">{f.title}</h3>
                  <p className="text-[13px] text-[#AAB5AF] leading-relaxed">{f.body}</p>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          STATS COUNTERS
      ════════════════════════════════════════════════ */}
      <Section className="py-20 px-6 md:px-10">
        <div className="max-w-[1440px] mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {[
              { value: 96, suffix: "%", label: "Max AI Confidence Score", color: "text-[#EF4444]" },
              { value: 14, suffix: "s", label: "Avg time to first finding", color: "text-[#2E7D32]" },
              { value: 5, suffix: " tools", label: "Analysis engines combined", color: "text-[#3B82F6]" },
              { value: 100, suffix: "%", label: "Evidence before AI", color: "text-[#F59E0B]" },
            ].map((stat) => (
              <FadeIn key={stat.label}>
                <div className="bg-[#101915] border border-[#1E3025] rounded-2xl p-6 text-center">
                  <p className={`text-4xl font-bold font-mono ${stat.color}`}>
                    <Counter to={stat.value} suffix={stat.suffix} />
                  </p>
                  <p className="text-[12px] text-[#7E8A84] mt-2 leading-snug">{stat.label}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          HOW BUGZERO WORKS — timeline / vertical steps
      ════════════════════════════════════════════════ */}
      <Section className="py-28 px-6 md:px-10 bg-[#0B120F] border-y border-[#1E3025]">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">How It Works</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">From upload to actionable findings in seconds</h2>
          </FadeIn>

          <div className="relative max-w-3xl mx-auto">
            {/* Vertical line */}
            <div className="absolute left-[27px] top-4 bottom-4 w-[2px] bg-[#1E3025]" />
            <div className="space-y-8">
              {[
                { n: "01", title: "Upload Repository", body: "Drop your Python source files or ZIP archive. BugZero ingests and normalises code within seconds.", color: "bg-[#3B82F6]" },
                { n: "02", title: "Pylint + Bandit Scan", body: "Automated static analysis detects code quality issues, hardcoded secrets, SQL injection risks, and security anti-patterns.", color: "bg-[#F59E0B]" },
                { n: "03", title: "CodeBERT Classification", body: "Fine-tuned ML model categorises each finding and assigns a verified confidence score from 0 to 100%.", color: "bg-[#2E7D32]" },
                { n: "04", title: "LLM Root-Cause Analysis", body: "Your selected AI provider (OpenAI or Claude) generates human-readable explanations and patch diffs — grounded in static analysis evidence.", color: "bg-[#AAB5AF]" },
                { n: "05", title: "Review Findings + Export", body: "Browse prioritised findings, resolve issues, track health trends, and export professional PDF or JSON audit reports.", color: "bg-[#4CAF50]" },
              ].map((step, i) => (
                <FadeIn key={step.n} delay={i * 0.1} className="relative flex items-start gap-6">
                  <div className={`w-14 h-14 rounded-full ${step.color} flex items-center justify-center text-white font-bold text-sm shrink-0 z-10 shadow-lg`}>
                    {step.n}
                  </div>
                  <div className="bg-[#101915] border border-[#1E3025] rounded-2xl p-5 flex-1 hover:border-[#294134] transition-colors">
                    <h4 className="text-[15px] font-bold mb-1">{step.title}</h4>
                    <p className="text-[13px] text-[#AAB5AF] leading-relaxed">{step.body}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          COMPARISON TABLE
      ════════════════════════════════════════════════ */}
      <Section className="py-28 px-6 md:px-10">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">BugZero vs. Traditional Code Review</h2>
          </FadeIn>

          <FadeIn>
            <div className="overflow-x-auto rounded-2xl border border-[#1E3025]">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="bg-[#0B120F] border-b border-[#1E3025]">
                    <th className="px-6 py-4 font-semibold text-[#7E8A84] uppercase text-[11px] tracking-wider">Feature</th>
                    <th className="px-6 py-4 font-semibold text-[#2E7D32] uppercase text-[11px] tracking-wider">BugZero AI Platform</th>
                    <th className="px-6 py-4 font-semibold text-[#7E8A84] uppercase text-[11px] tracking-wider">Manual / Traditional</th>
                  </tr>
                </thead>
                <tbody className="bg-[#101915] divide-y divide-[#1E3025]">
                  {[
                    ["Static Analysis", "Automatic (Pylint + Bandit)", "Manual / Inconsistent"],
                    ["Confidence Scoring", "CodeBERT ML (0–100%)", "Subjective human judgment"],
                    ["Suggested Code Diffs", "Instant patch preview", "Manual writing required"],
                    ["Repository Health Tracking", "Continuous longitudinal metrics", "Not available"],
                    ["Exportable Audit Reports", "PDF + JSON one-click export", "Manual documentation"],
                    ["Evidence Before AI", "Always — static analysis first", "Typically skipped"],
                  ].map(([feat, bugzero, manual], i) => (
                    <motion.tr
                      key={feat}
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.05 }}
                      className="hover:bg-[#16211B] transition-colors"
                    >
                      <td className="px-6 py-4 font-semibold text-white">{feat}</td>
                      <td className="px-6 py-4">
                        <span className="flex items-center gap-2 text-[#4CAF50] font-medium">
                          <CheckCircle2 className="w-4 h-4 shrink-0" /> {bugzero}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="flex items-center gap-2 text-[#7E8A84]">
                          <XCircle className="w-4 h-4 shrink-0" /> {manual}
                        </span>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeIn>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          TECH STACK
      ════════════════════════════════════════════════ */}
      <Section id="tech-stack" className="py-28 px-6 md:px-10 bg-[#0B120F] border-y border-[#1E3025]">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">Tech Stack</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Built on a modern, open-source stack</h2>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {[
              { layer: "Frontend",         color: "text-[#3B82F6]", border: "border-[#3B82F6]/20", bg: "bg-[#3B82F6]/5",
                items: ["Next.js 15 App Router","TypeScript Strict","Tailwind CSS","TanStack Query","Framer Motion"] },
              { layer: "Backend API",      color: "text-[#2E7D32]", border: "border-[#2E7D32]/20", bg: "bg-[#2E7D32]/5",
                items: ["FastAPI","Python 3.11","PostgreSQL","SQLAlchemy","Pydantic v2"] },
              { layer: "Static Analysis",  color: "text-[#F59E0B]", border: "border-[#F59E0B]/20", bg: "bg-[#F59E0B]/5",
                items: ["Pylint","Bandit","CWE Mappings","AST Parsing","OWASP Top 10"] },
              { layer: "ML & XAI",         color: "text-[#AAB5AF]", border: "border-[#AAB5AF]/20", bg: "bg-[#AAB5AF]/5",
                items: ["CodeBERT Base","OpenAI GPT-4o","Claude 3.5 Sonnet","Confidence Scoring","LLM Patch Diffs"] },
            ].map((stack) => (
              <FadeIn key={stack.layer}>
                <motion.div
                  whileHover={{ y: -3 }}
                  className={`bg-[#101915] border ${stack.border} rounded-2xl p-6 space-y-4 h-full ${stack.bg} hover:border-opacity-50 transition-all`}
                >
                  <h4 className={`text-[13px] font-bold uppercase tracking-wider ${stack.color}`}>{stack.layer}</h4>
                  <ul className="space-y-2">
                    {stack.items.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-[13px] text-[#AAB5AF]">
                        <span className={`w-1.5 h-1.5 rounded-full bg-current ${stack.color} shrink-0`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </FadeIn>
            ))}
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          FAQ — expandable accordion
      ════════════════════════════════════════════════ */}
      <Section id="faq" className="py-28 px-6 md:px-10">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">FAQ</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Frequently asked questions</h2>
          </FadeIn>

          <div className="max-w-3xl mx-auto space-y-3">
            {[
              { q: "What programming languages are supported?",
                a: "BugZero provides full static analysis and CodeBERT classification for Python 3.x. JavaScript, TypeScript, and Go support is in active development." },
              { q: "Does BugZero replace human developers?",
                a: "No. BugZero surfaces evidence-backed findings, confidence scores, and code diffs so teams make faster, better-informed decisions. Human judgment remains central." },
              { q: "Can I export audit reports?",
                a: "Yes. Every repository review can be exported as a professional PDF or raw JSON report for compliance, handoffs, and team sharing." },
              { q: "Is my code secure?",
                a: "Your code is never used for model retraining and is processed securely using industry-standard encryption. BugZero is a stateless analysis service." },
              { q: "How does BugZero differ from a simple linter?",
                a: "Linters surface syntax issues. BugZero runs Pylint + Bandit static analysis, then layers CodeBERT ML classification and LLM root-cause explanations to give you the full picture: what's wrong, why it matters, and how to fix it." },
            ].map((faq) => (
              <FadeIn key={faq.q}>
                <FAQItem q={faq.q} a={faq.a} />
              </FadeIn>
            ))}
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          FINAL CTA
      ════════════════════════════════════════════════ */}
      <Section className="py-32 px-6 md:px-10">
        <div className="max-w-[1440px] mx-auto">
          <FadeIn>
            <div className="relative overflow-hidden bg-[#101915] border border-[#2E7D32]/30 rounded-3xl p-12 md:p-20 text-center space-y-8">
              {/* Background glow */}
              <div
                className="absolute inset-0 opacity-[0.07]"
                style={{ background: "radial-gradient(ellipse at center, #2E7D32 0%, transparent 70%)" }}
              />

              <div className="relative space-y-5 max-w-2xl mx-auto">
                <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-semibold bg-[#2E7D32]/15 text-[#4CAF50] border border-[#2E7D32]/35">
                  <Sparkles className="w-3.5 h-3.5" /> Start today — no setup required
                </span>
                <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
                  Start reviewing smarter today
                </h2>
                <p className="text-[16px] text-[#AAB5AF] leading-relaxed">
                  Join engineering teams using BugZero to eliminate security risks, track repository health, and ship with confidence.
                </p>
              </div>

              <div className="relative flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/repositories">
                  <motion.button
                    whileHover={{ scale: 1.03, boxShadow: "0 0 40px rgba(46,125,50,0.4)" }}
                    whileTap={{ scale: 0.97 }}
                    className="flex items-center gap-2.5 h-14 px-10 bg-[#2E7D32] hover:bg-[#388E3C] text-white text-[15px] font-bold rounded-xl transition-all"
                  >
                    <Play className="w-4 h-4" />
                    Start Reviewing
                    <ArrowRight className="w-4 h-4" />
                  </motion.button>
                </Link>
                <a href="https://github.com" target="_blank" rel="noreferrer">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    className="flex items-center gap-2.5 h-14 px-8 border border-[#1E3025] hover:border-[#294134] hover:bg-[#16211B] text-white text-[15px] font-semibold rounded-xl transition-all"
                  >
                    <Github className="w-4 h-4" />
                    View on GitHub
                  </motion.button>
                </a>
              </div>
            </div>
          </FadeIn>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════ */}
      <footer className="border-t border-[#1E3025] bg-[#0B120F] px-6 md:px-10 py-10">
        <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-[12px] text-[#7E8A84]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#2E7D32]" />
            <span className="font-bold text-white">BugZero</span>
            <span>— AI Repository Review Platform</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6">
            <Link href="/repositories" className="hover:text-white transition-colors">Repositories</Link>
            <Link href="/reports" className="hover:text-white transition-colors">Reports</Link>
            <Link href="/settings" className="hover:text-white transition-colors">Settings</Link>
            <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-white transition-colors flex items-center gap-1">
              <Github className="w-3.5 h-3.5" /> GitHub
            </a>
          </div>
          <span>© 2026 BugZero. All rights reserved.</span>
        </div>
      </footer>

    </div>
  );
}
