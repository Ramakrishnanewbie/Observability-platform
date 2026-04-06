"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/dashboard";

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const supabase = getSupabaseBrowserClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (mode === "signup") {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (signUpError) throw signUpError;
        // If no session, email confirmation is required
        if (!signUpData.session) {
          setError("Check your email for a confirmation link, then sign in.");
          setLoading(false);
          setMode("login");
          return;
        }
        router.push("/onboarding");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        router.push(redirect);
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: "google" | "github") => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?redirect=${redirect}` },
    });
    if (error) setError(error.message);
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left: Brand panel ── */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] relative overflow-hidden bg-gradient-to-br from-[hsl(220,25%,6%)] via-[hsl(220,30%,8%)] to-[hsl(195,30%,10%)]">
        {/* Ambient glow */}
        <div className="absolute top-1/4 -left-20 w-80 h-80 rounded-full bg-primary/8 blur-[100px]" />
        <div className="absolute bottom-1/4 right-0 w-60 h-60 rounded-full bg-primary/5 blur-[80px]" />

        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <span className="text-xl text-primary">◈</span>
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-foreground">Observo</span>
              <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase tracking-wider">Platform</span>
            </div>
          </div>

          {/* Hero */}
          <div className="space-y-6">
            <h2 className="text-3xl font-bold tracking-tight leading-tight">
              Monitor everything.<br />
              <span className="text-primary">From anywhere.</span>
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-[360px]">
              Enterprise-grade observability platform. Metrics, logs, traces, and alerts — unified in one place. 
              Supports OpenTelemetry, AWS, GCP, Azure, and on-premise infrastructure.
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-2">
              {["Metrics", "Logs", "Traces", "Alerts", "OTLP", "Multi-cloud"].map((f) => (
                <span key={f} className="text-[10px] font-semibold text-muted-foreground/70 px-2.5 py-1 rounded-full border border-border/50 bg-card/30">
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* Social proof */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {["#3B82F6", "#A855F7", "#22C55E", "#F97316"].map((c, i) => (
                  <div key={i} className="w-7 h-7 rounded-full border-2 border-[hsl(220,25%,6%)] flex items-center justify-center text-[9px] font-bold text-white"
                    style={{ background: c, zIndex: 4 - i }}>
                    {["R", "A", "K", "M"][i]}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">Trusted by engineering teams worldwide</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: Auth form ── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 bg-background">
        <div className="w-full max-w-[380px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-2.5 mb-8">
            <span className="text-3xl text-primary">◈</span>
            <span className="text-2xl font-bold tracking-tight">Observo</span>
          </div>

          <div className="mb-8">
            <h1 className="text-xl font-bold tracking-tight mb-1">
              {mode === "login" ? "Welcome back" : "Get started"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === "login" ? "Sign in to your Observo workspace" : "Create your Observo account"}
            </p>
          </div>

          {/* OAuth */}
          <div className="grid grid-cols-2 gap-2 mb-5">
            <button
              onClick={() => handleOAuth("google")}
              className="h-10 flex items-center justify-center gap-2 rounded-lg border border-border bg-card text-xs font-medium hover:bg-accent hover:border-foreground/10 transition-all"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Google
            </button>
            <button
              onClick={() => handleOAuth("github")}
              className="h-10 flex items-center justify-center gap-2 rounded-lg border border-border bg-card text-xs font-medium hover:bg-accent hover:border-foreground/10 transition-all"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              GitHub
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] text-muted-foreground/50 uppercase tracking-widest font-semibold">or continue with email</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Full Name</label>
                <input
                  type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe" required autoComplete="name"
                  className="w-full h-10 px-3 rounded-lg border border-input bg-card text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground/40 transition-all"
                />
              </div>
            )}
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Email</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com" required autoComplete="email"
                className="w-full h-10 px-3 rounded-lg border border-input bg-card text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground/40 transition-all"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" required minLength={6} autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  className="w-full h-10 px-3 pr-10 rounded-lg border border-input bg-card text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground/40 transition-all"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-[12px] text-red-400 bg-red-500/8 border border-red-500/15 rounded-lg px-3 py-2.5 flex items-start gap-2">
                <span className="text-red-400 mt-px">⚠</span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 group"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {mode === "login" ? "Sign In" : "Create Account"}
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>

          {/* Toggle */}
          <p className="text-center text-xs text-muted-foreground mt-6">
            {mode === "login" ? (
              <>Don&apos;t have an account?{" "}
                <button onClick={() => { setMode("signup"); setError(""); }} className="text-primary font-semibold hover:underline">
                  Sign up
                </button>
              </>
            ) : (
              <>Already have an account?{" "}
                <button onClick={() => { setMode("login"); setError(""); }} className="text-primary font-semibold hover:underline">
                  Sign in
                </button>
              </>
            )}
          </p>

          {/* Footer */}
          <p className="text-center text-[10px] text-muted-foreground/40 mt-8">
            By continuing, you agree to Observo&apos;s Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AuthForm />
    </Suspense>
  );
}
