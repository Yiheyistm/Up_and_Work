interface SkeletonProps {
  lines?: number;
  className?: string;
}

export default function Skeleton({ lines = 3, className = '' }: SkeletonProps) {
  return (
    <div className={className} style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          style={{
            background: 'var(--color-surface-2)',
            borderRadius: '4px',
            height: '16px',
            marginBottom: '12px',
            width: i === lines - 1 ? '60%' : '100%',
          }}
        />
      ))}
    </div>
  );
}