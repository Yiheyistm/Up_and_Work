import type { ReactNode } from 'react';

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: number | string;
  highlight?: boolean;
}

export default function StatCard({ icon, label, value, highlight = false }: StatCardProps) {
  return (
    <div style={{
      background: 'var(--gradient-card)',
      border: `1px solid ${highlight ? 'var(--color-accent)' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4)',
    }}>
      <div style={{ marginBottom: 'var(--space-3)' }}>{icon}</div>
      <div style={{
        fontSize: '1.8rem',
        fontWeight: 700,
        color: highlight ? 'var(--color-accent)' : 'var(--color-text)',
      }}>{value}</div>
      <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>{label}</div>
    </div>
  );
}