import type { ReactNode } from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--gradient-accent)', color: 'white' },
    secondary: { background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' },
    danger: { background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)' },
    ghost: { background: 'transparent', color: 'var(--color-text-muted)' },
  };

  const sizes: Record<string, React.CSSProperties> = {
    sm: { padding: '6px 12px', fontSize: '0.85rem' },
    md: { padding: '8px 16px', fontSize: '0.9rem' },
    lg: { padding: '12px 24px', fontSize: '1rem' },
  };

  const style: React.CSSProperties = {
    ...variants[variant],
    ...sizes[size],
    opacity: disabled || loading ? 0.5 : 1,
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    borderRadius: 'var(--radius-md)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontWeight: 600,
    transition: 'background 0.15s, color 0.15s',
    outline: 'none',
    fontFamily: 'var(--font-sans)',
    lineHeight: 1.5,
    textAlign: 'center',
    textDecoration: 'none',
    verticalAlign: 'middle',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  return (
    <button
      style={style}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <svg style={{ animation: 'spin 1s linear infinite', height: '16px', width: '16px' }} viewBox="0 0 24 24" fill="none">
          <circle opacity={0.25} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path opacity={0.75} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {icon && !loading && <span>{icon}</span>}
      {children}
    </button>
  );
}