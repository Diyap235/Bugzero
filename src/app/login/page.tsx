"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShieldCheck, Mail, Lock, User as UserIcon, Github, Chrome,
  ArrowRight, Sparkles, Shield, Cpu, TrendingUp, CheckCircle2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/shared/Input";
import { authService } from "@/services/auth.service";

// Simulated "AI scanning" code lines
const SCAN_LINES = [
  { text: "▸ Initialising Pylint static analyser…",   delay: 0,    color: "text-[#7E8A84]"  },
  { text: "▸ Running Bandit security scan…",           delay: 400,  color: "text-[#7E8A84]"  },
  { text: "  [B608] SQL Injection — user_repo.py:48",  delay: 900,  color: "text-[#EF4444]"  },
  { text: "  [B105] Hardcoded token — config.py:19",   delay: 1300, color: "text-[#F59E0B]"  },
  { text: "▸ Loading CodeBERT classifier…",            delay: 1700, color: "text-[#7E8A84]"  },
  { text: "  Confidence: 96% (SQL Injection)",         delay: 2100, color: "text-[#4CAF50]"  },
  { text: "  Confidence: 91% (Hardcoded Secret)",      delay: 2400, color: "text-[#4CAF50]"  },
  { text: "▸ Generating AI root-cause analysis…",      delay: 2800, color: "text-[#2E7D32]"  },
  { text: "  ✓ Patch diff generated for B608",         delay: 3300, color: "text-[#4CAF50]"  },
  { text: "  ✓ Patch diff generated for B105",         delay: 3600, color: "text-[#4CAF50]"  },
  { text: "▸ Repository health score: 84/100",         delay: 4000, color: "text-[#AAB5AF]"  },
  { text: "  ✓ Analysis complete in 1.4s",             delay: 4400, color: "text-[#4CAF50]"  },
];

function ScannerPanel() {
  const [visibleCount, setVisibleCount] = useState(0);
  const [cursor, setCursor] = useState(true);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    SCAN_LINES.forEach((line, i) => {
      timers.push(setTimeout(() => setVisibleCount(i + 1), line.delay));
    });
    // Blink cursor
    const blink = setInterval(() => setCursor((c) => !c), 530);
    return () => { timers.forEach(clearTimeout); clearInterval(blink); };
  }, []);

  return (
    <div className="h-full flex flex-col justify-between">
      {/* Brand */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-10 h-10 rounded-2xl bg-[#2E7D32]/20 border border-[#2E7D32]/40 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-[#2E7D32]" />
        </div>
        <div>
          <span className="text-xl font-bold tracking-wider text-white">
            BUG<span className="text-[#2E7D32]">ZERO</span>
          </span>
          <p className="text-[10px] text-[#7E8A84] font-mono uppercase tracking-widest">AI Review Platform</p>
        </div>
      </div>

      {/* Headline */}
      <div className="space-y-4 mb-8">
        <h2 className="text-3xl font-bold text-white leading-tight">
          AI that reads code<br />
          <span className="text-[#2E7D32]">the way engineers do.</span>
        </h2>
        <p className="text-[14px] text-[#AAB5AF] leading-relaxed max-w-xs">
          Evidence-first static analysis, CodeBERT ML scoring, and explainable root-cause diffs — all in under 2 seconds.
        </p>
      </div>

      {/* Animated terminal */}
      <div className="flex-1 bg-[#050705] border border-[#1E3025] rounded-2xl p-4 font-mono text-[11px] space-y-1 overflow-hidden">
        <div className="flex items-center gap-1.5 mb-3 pb-2 border-b border-[#1E3025]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444]/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#4CAF50]/60" />
          <span className="ml-2 text-[#7E8A84]">bugzero — analysis</span>
        </div>
        {SCAN_LINES.slice(0, visibleCount).map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className={line.color}
          >
            {line.text}
          </motion.div>
        ))}
        {visibleCount < SCAN_LINES.length && (
          <span className="text-[#2E7D32]">{cursor ? "▋" : " "}</span>
        )}
        {visibleCount >= SCAN_LINES.length && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-3 pt-3 border-t border-[#1E3025] flex items-center gap-2 text-[#4CAF50] font-semibold"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Ready to review
          </motion.div>
        )}
      </div>

      {/* Trust pills */}
      <div className="flex flex-wrap gap-2 mt-6">
        {[
          { icon: Shield,  label: "Bandit + Pylint" },
          { icon: Cpu,     label: "CodeBERT ML"     },
          { icon: Sparkles,label: "GPT-4o / Claude" },
        ].map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0B120F] border border-[#1E3025] text-[11px] text-[#AAB5AF]">
            <Icon className="w-3 h-3 text-[#2E7D32]" />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AuthPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("alex.vance@engineering.io");
  const [password, setPassword] = useState("password123");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Please fill in all required fields."); return; }
    if (tab === "register" && password !== confirmPassword) { setError("Passwords do not match."); return; }
    setIsLoading(true);
    try {
      if (tab === "login") await authService.login(email, password);
      else await authService.register(name || "Developer", email, password);
      setIsDone(true);
      setTimeout(() => router.push("/repositories"), 800);
    } catch {
      setError("Authentication failed. Please check your credentials.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050705] text-white flex">
      {/* Left — branding panel */}
      <motion.div
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="hidden lg:flex w-[480px] shrink-0 bg-[#0B120F] border-r border-[#1E3025] p-12 flex-col"
      >
        <ScannerPanel />
      </motion.div>

      {/* Right — auth form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md space-y-8"
        >
          {/* Mobile brand */}
          <div className="lg:hidden flex items-center gap-2 mb-2">
            <ShieldCheck className="w-5 h-5 text-[#2E7D32]" />
            <span className="text-lg font-bold">BUG<span className="text-[#2E7D32]">ZERO</span></span>
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {tab === "login" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-[13px] text-[#AAB5AF] mt-1">
              {tab === "login"
                ? "Sign in to your AI review workspace"
                : "Start reviewing repositories with AI today"}
            </p>
          </div>

          {/* Tab toggle */}
          <div className="flex p-1 bg-[#0B120F] border border-[#1E3025] rounded-2xl">
            {(["login","register"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(""); }}
                className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                  tab === t
                    ? "bg-[#101915] text-white border border-[#1E3025] shadow-sm"
                    : "text-[#7E8A84] hover:text-white"
                }`}
              >
                {t === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.form
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              onSubmit={handleSubmit}
              className="space-y-4"
            >
              {tab === "register" && (
                <div>
                  <label className="block text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-1.5">Full Name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Vance" leftIcon={<UserIcon className="w-4 h-4" />} />
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-1.5">Email Address</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.io" leftIcon={<Mail className="w-4 h-4" />} error={error} />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-1.5">Password</label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" leftIcon={<Lock className="w-4 h-4" />} />
              </div>

              {tab === "register" && (
                <div>
                  <label className="block text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-1.5">Confirm Password</label>
                  <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" leftIcon={<Lock className="w-4 h-4" />} />
                </div>
              )}

              {tab === "login" && (
                <div className="flex items-center justify-between text-[12px] text-[#7E8A84]">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" defaultChecked className="rounded border-[#1E3025] bg-[#0B120F] text-[#2E7D32]" />
                    Remember me
                  </label>
                  <a href="#" className="hover:text-white transition-colors">Forgot password?</a>
                </div>
              )}

              <motion.button
                type="submit"
                disabled={isLoading || isDone}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full h-12 flex items-center justify-center gap-2.5 bg-[#2E7D32] hover:bg-[#388E3C] disabled:opacity-60 text-white text-[14px] font-bold rounded-xl transition-all"
              >
                {isDone ? (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5" /> Signed in!
                  </motion.span>
                ) : isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    {tab === "login" ? "Signing in…" : "Creating account…"}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    {tab === "login" ? "Sign In to BugZero" : "Create Account"}
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </motion.button>
            </motion.form>
          </AnimatePresence>

          {/* Divider */}
          <div className="relative flex items-center gap-3">
            <div className="flex-1 h-px bg-[#1E3025]" />
            <span className="text-[11px] text-[#7E8A84] uppercase tracking-widest">or</span>
            <div className="flex-1 h-px bg-[#1E3025]" />
          </div>

          {/* OAuth */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Continue with Google", icon: Chrome, action: () => router.push("/repositories") },
              { label: "Continue with GitHub", icon: Github, action: () => router.push("/repositories") },
            ].map(({ label, icon: Icon, action }) => (
              <motion.button
                key={label}
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={action}
                className="flex items-center justify-center gap-2 h-11 border border-[#1E3025] hover:border-[#294134] hover:bg-[#16211B] text-[12px] font-medium text-[#AAB5AF] rounded-xl transition-all"
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{label.split(" ").pop()}</span>
                <span className="sm:hidden">{label}</span>
              </motion.button>
            ))}
          </div>

          <p className="text-center text-[12px] text-[#7E8A84]">
            {tab === "login" ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => setTab(tab === "login" ? "register" : "login")} className="text-[#2E7D32] hover:text-[#4CAF50] font-semibold transition-colors">
              {tab === "login" ? "Sign up free" : "Sign in"}
            </button>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
