/**
 * Ensures Tailwind v4's Oxide scanner in `apps/web` emits every utility token
 * referenced inside `@cartridgefi/ui-system` without modifying `globals.css`.
 */
export const UI_SYSTEM_TAILWIND_SAFELIST = [
  "group/solana group-hover/solana:opacity-0 group-hover/solana:opacity-100 group-hover/solana:text-white",
  "group/magicblock group-hover/magicblock:opacity-0 group-hover/magicblock:opacity-100 group-hover/magicblock:text-white",
  "bg-[#00F59B] bg-[#00F59B]/10 bg-[#00F59B]/15 bg-[#00F59B]/40 bg-[#00F59B]/55 bg-[#2EFFB0]",
  "border-[#00F59B] border-[#00F59B]/25 border-[#00F59B]/30 border-[#00F59B]/40 hover:border-[#2EFFB0]",
  "text-[#00F59B] text-[#050609] text-[#E2E8F0]",
  "bg-[#8B5CF6] bg-[#8B5CF6]/12 bg-[#8B5CF6]/15 bg-[#8B5CF6]/35 bg-[#8B5CF6]/45",
  "border-[#8B5CF6]/35 border-[#8B5CF6]/40 text-[#C4B5FD] text-[#C4B5FD]/80",
  "bg-[#00D4FF] bg-[#00D4FF]/10 bg-[#00D4FF]/12 bg-[#00D4FF]/40",
  "border-[#00D4FF]/35 hover:border-[#00D4FF]/40 text-[#00D4FF] text-[#67E8F9] focus-visible:ring-[#00D4FF]",
  "bg-[#FFB020] bg-[#FFB020]/10 bg-[#FFB020]/12 bg-[#FFB020]/15 bg-[#FFB020]/45 bg-[#FFB020]/70 hover:bg-[#FFB020]/20",
  "border-[#FFB020]/35 border-[#FFB020]/45 text-[#FFB020] text-[#FCD34D] focus-visible:ring-[#FFB020]",
  "bg-[#0C0F19]/95 bg-[#0B1218]/95 bg-[#111520]/80 bg-[#151B2B]/90 bg-[#181E2E]/85",
  "border-white/12 hover:border-white/22 hover:border-white/25",
  "border-white/[0.06] border-white/[0.07] border-white/[0.08]",
  "bg-white/[0.03] bg-white/[0.04] bg-white/[0.05] bg-white/[0.06] bg-white/[0.07] bg-white/[0.08]",
  "hover:bg-white/[0.06] hover:bg-white/[0.07] hover:bg-white/[0.08] hover:bg-white/[0.1] hover:bg-white/[0.12]",
  "bg-slate-600/60 group-hover:bg-slate-400/80 line-clamp-2",
  "tracking-[0.12em] tracking-[-0.025em] tracking-[-0.03em] text-[17px]",
  "h-[2px] w-7 gap-[3px] rounded-[2px] active:translate-y-[0.5px]",
  "shadow-[0_0_28px_-6px_rgba(0,245,155,0.5)]",
  "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14)]",
  "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14),0_28px_72px_-20px_rgba(0,0,0,0.78)]",
  "shadow-[inset_0_1px_0_0_rgba(139,92,246,0.28),0_18px_40px_-14px_rgba(0,0,0,0.75)]",
  "shadow-[inset_0_1px_0_0_rgba(0,245,155,0.28),0_18px_40px_-14px_rgba(0,0,0,0.75)]",
  "w-4/5 w-3/5 w-2/3 motion-reduce:animate-none",
] as const;
