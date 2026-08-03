import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hoverable?: boolean;
  onClick?: () => void;
}

export default function Card({ children, className = '', hoverable = false, onClick }: CardProps) {
  return (
    <div
      className={`${className}`}
      style={{
        background: 'var(--gradient-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        position: 'relative',
        cursor: hoverable ? 'pointer' : 'default',
        transition: hoverable ? 'border-color 0.2s, box-shadow 0.2s, transform 0.15s' : 'none',
      }}
      onClick={onClick}
      onMouseOver={hoverable ? (e) => {
        e.currentTarget.style.borderColor = 'var(--color-accent)';
        e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      } : undefined}
      onMouseOut={hoverable ? (e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'none';
      } : undefined}
    >
      {children}
    </div>
  );
}