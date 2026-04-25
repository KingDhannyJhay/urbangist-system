export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0B0B]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-green-500 flex items-center justify-center animate-pulse">
          <span className="text-[#0B0B0B] font-black text-sm" style={{fontFamily:'Syne,sans-serif'}}>UG</span>
        </div>
        <p className="text-xs text-[#525252]">Loading…</p>
      </div>
    </div>
  );
}
