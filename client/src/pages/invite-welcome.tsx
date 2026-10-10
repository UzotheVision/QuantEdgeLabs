import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, BarChart3, LineChart, BookOpen } from "lucide-react";

export default function InviteWelcome() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const [inviteCode, setInviteCode] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(search);
    const code = params.get("code") || params.get("invite") || "";
    setInviteCode(code);
  }, [search]);

  const handleAcceptInvite = () => {
    if (inviteCode) {
      navigate(`/join-beta?code=${inviteCode}`);
    } else {
      navigate("/join-beta");
    }
  };

  const features = [
    { icon: Sparkles, label: "AI-powered analysis" },
    { icon: BarChart3, label: "Quantitative signals" },
    { icon: LineChart, label: "Chart pattern detection" },
    { icon: BookOpen, label: "Trading journal" },
  ];

  return (
    <div className="min-h-screen bg-[var(--surface-base)] flex items-center justify-center p-6 relative overflow-hidden">
      {/* Subtle gradient accent */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-sky-500/5 blur-[120px] rounded-full pointer-events-none" />
      
      <div className="w-full max-w-md relative z-10">
        
        {/* Logo with subtle glow */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <span className="text-lg font-bold text-white">Q</span>
            </div>
            <div>
              <span className="text-xl font-bold text-white tracking-tight">QUANT EDGE</span>
              <span className="text-neutral-600 mx-2">|</span>
              <span className="text-sm font-medium text-neutral-500 tracking-widest">LABS</span>
            </div>
          </div>
        </div>

        {/* Main Card with subtle border glow */}
        <div className="bg-card border border-neutral-800/80 rounded-2xl p-8 shadow-2xl shadow-black/50 relative">
          {/* Subtle top accent line */}
          <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-sky-500/30 to-transparent" />
          
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-medium mb-4">
              <Sparkles className="w-3 h-3" />
              Exclusive Beta Access
            </div>
            <h1 className="text-2xl font-semibold text-white mb-2" data-testid="text-invite-title">
              You're Invited
            </h1>
            <p className="text-neutral-400 text-sm">
              Join the beta of our quantitative trading platform.
            </p>
          </div>

          {/* Features with icons */}
          <div className="space-y-3 mb-8">
            {features.map((feature, idx) => (
              <div key={idx} className="flex items-center gap-3 text-neutral-300 text-sm group">
                <div className="w-8 h-8 rounded-lg bg-neutral-800/50 border border-neutral-700/50 flex items-center justify-center group-hover:border-sky-500/30 transition-colors">
                  <feature.icon className="w-4 h-4 text-sky-400" />
                </div>
                {feature.label}
              </div>
            ))}
          </div>

          {/* CTA Button */}
          <Button 
            onClick={handleAcceptInvite}
            className="w-full h-12 bg-sky-500 hover:bg-sky-400 text-black font-semibold rounded-xl shadow-lg shadow-sky-500/20 transition-all hover:shadow-sky-500/30"
            data-testid="button-accept-invite"
          >
            Accept Invitation
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>

        {/* Footer */}
        <p className="text-center text-neutral-600 text-xs mt-6">
          For educational and research purposes only.
        </p>
      </div>
    </div>
  );
}
