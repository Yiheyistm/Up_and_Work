import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Button from './Button';

interface PaginationProps {
  current: number;
  total: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ current, total, onPageChange }: PaginationProps) {
  if (total <= 1) return null;

  const pages: ReactNode[] = [];
  const maxVisible = 5;
  let start = Math.max(1, current - Math.floor(maxVisible / 2));
  let end = Math.min(total, start + maxVisible - 1);
  if (end - start < maxVisible - 1) {
    start = Math.max(1, end - maxVisible + 1);
  }

  for (let i = start; i <= end; i++) {
    pages.push(
      <button
        key={i}
        onClick={() => onPageChange(i)}
        style={{
          width: '36px',
          height: '36px',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.85rem',
          fontWeight: 600,
          border: '1px solid var(--color-border)',
          background: i === current ? 'var(--color-accent)' : 'var(--color-surface-2)',
          color: i === current ? '#fff' : 'var(--color-text-muted)',
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
      >
        {i}
      </button>
    );
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--space-2)',
      marginTop: 'var(--space-6)',
    }}>
      <Button variant="secondary" size="sm" onClick={() => onPageChange(current - 1)} disabled={current <= 1}>
        <ChevronLeft size={16} />
      </Button>
      {pages}
      <Button variant="secondary" size="sm" onClick={() => onPageChange(current + 1)} disabled={current >= total}>
        <ChevronRight size={16} />
      </Button>
    </div>
  );
}