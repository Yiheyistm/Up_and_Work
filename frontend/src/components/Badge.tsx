import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'accent' | 'success' | 'warning' | 'danger' | 'muted';
  size?: 'sm' | 'md';
}

const variants: Record<string, { bg: string; color: string }> = {
  accent: { bg: 'var(--color-accent)', color: '#fff' },
  success: { bg: 'var(--color-success)', color: '#fff' },
  warning: { bg: 'var(--color-warning)', color: 'var(--color-bg)' },
  danger: { bg: 'var(--color-danger)', color: '#fff' },
  muted: { bg: 'var(--color-surface-2)', color: 'var(--color-text-muted)' },
};

export default function Badge({ children, variant = 'accent', size = 'sm' }: BadgeProps) {
  const v = variants[variant];
  const padding = size === 'sm' ? '2px 8px' : '4px 12px';
  const fontSize = size === 'sm' ? '0.75rem' : '0.85rem';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      fontWeight: 600,
      borderRadius: '9999px',
      background: v.bg,
      color: v.color,
      padding,
      fontSize,
    }}>
      {children}
    </span>
  );
}