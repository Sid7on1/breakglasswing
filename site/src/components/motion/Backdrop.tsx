// Cinematic coded backdrop: drifting gradient-mesh blobs + technical grid + film grain. Used wherever
// the brief calls for an ambient video — it looks premium on its own, and a real <video> can layer
// over it later (same container) when assets arrive.
export default function Backdrop({
  grid = true,
  blobs = true,
  className,
}: {
  grid?: boolean;
  blobs?: boolean;
  className?: string;
}) {
  return (
    <div className={`grain pointer-events-none absolute inset-0 overflow-hidden ${className ?? ''}`} aria-hidden>
      {blobs && (
        <>
          <span
            className="blob"
            style={{
              top: '-10%',
              right: '8%',
              width: 520,
              height: 520,
              background: 'radial-gradient(circle, rgba(52,211,153,0.22), transparent 65%)',
              animation: 'float-a 16s ease-in-out infinite',
            }}
          />
          <span
            className="blob"
            style={{
              bottom: '-15%',
              left: '-5%',
              width: 560,
              height: 560,
              background: 'radial-gradient(circle, rgba(59,130,246,0.16), transparent 65%)',
              animation: 'float-b 20s ease-in-out infinite',
            }}
          />
          <span
            className="blob"
            style={{
              top: '30%',
              left: '40%',
              width: 380,
              height: 380,
              background: 'radial-gradient(circle, rgba(52,211,153,0.1), transparent 60%)',
              animation: 'float-c 24s ease-in-out infinite',
            }}
          />
        </>
      )}
      {grid && (
        <div className="absolute inset-0 bg-grid [mask-image:radial-gradient(75%_65%_at_50%_30%,#000,transparent)]" />
      )}
    </div>
  );
}
