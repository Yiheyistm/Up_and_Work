/**
 * Analytics.tsx — Analytics Dashboard Page
 *
 * Visualises all key metrics from the AI job monitoring pipeline:
 *  - KPI stat cards (total, applied, hired, avg score)
 *  - Application funnel with animated bars
 *  - Match score distribution (high / medium / low)
 *  - Daily job intake trend (sparkline SVG area chart)
 *  - Budget type breakdown (hourly vs fixed)
 *  - Top requested skills bar chart
 *  - Score histogram (10 buckets)
 *
 * All data comes from /api/v1/analytics/* endpoints which run server-side
 * PostgreSQL aggregations — no large dataset downloads.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import {
  Activity, Target, CheckCircle, Award, TrendingUp,
  Briefcase, BarChart2, Zap, Clock,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Overview {
  total_analyzed: number;
  shortlisted: number;
  applied: number;
  interviewing: number;
  hired: number;
  ignored: number;
  avg_match_score: number;
  max_match_score: number;
  match_distribution: { high: number; medium: number; low: number };
}

interface ScoreDist { buckets: Record<string, number>; total: number; }
interface Trend     { trend: { date: string; count: number }[]; days: number; }
interface Budget    {
  hourly: { count: number; pct: number; avg_min: number; avg_max: number };
  fixed:  { count: number; pct: number; avg: number };
}
interface TopSkills { skills: { skill: string; count: number }[]; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useAnimatedValue(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let start: number | null = null;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      // ease-out cubic
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return value;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, sub, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderTop: `2px solid ${accent ?? 'var(--color-accent)'}`,
      borderRadius: '12px',
      padding: '20px 22px',
      display: 'flex', flexDirection: 'column', gap: '10px',
    }}>
      <div style={{
        width: '38px', height: '38px', borderRadius: '10px',
        background: `${accent ?? 'var(--color-accent)'}22`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: '1.9rem', fontWeight: 800, lineHeight: 1, color: 'var(--color-text)' }}>
          {value}
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          {label}
        </div>
        {sub && <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>{sub}</div>}
      </div>
    </div>
  );
}

function AnimatedBar({
  label, value, total, color,
}: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const [width, setWidth] = useState(0);
  useEffect(() => { setTimeout(() => setWidth(pct), 100); }, [pct]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', marginBottom: '6px', fontWeight: 600 }}>
        <span style={{ color: 'var(--color-text)' }}>{label}</span>
        <span style={{ color }}>{value} <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>({pct.toFixed(0)}%)</span></span>
      </div>
      <div style={{ height: '8px', background: 'var(--color-bg)', borderRadius: '99px', overflow: 'hidden' }}>
        <div style={{
          width: `${width}%`, height: '100%', background: color,
          borderRadius: '99px', transition: 'width 0.8s cubic-bezier(0.34,1.56,0.64,1)',
        }} />
      </div>
    </div>
  );
}

function FunnelStep({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const [w, setW] = useState(0);
  const pct = max > 0 ? (value / max) * 100 : 0;
  useEffect(() => { setTimeout(() => setW(pct), 150); }, [pct]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{ width: '90px', fontSize: '0.82rem', color: 'var(--color-text-muted)', textAlign: 'right', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, height: '28px', background: 'var(--color-bg)', borderRadius: '6px', overflow: 'hidden', position: 'relative' }}>
        <div style={{
          width: `${w}%`, height: '100%', background: color,
          borderRadius: '6px', transition: 'width 0.9s cubic-bezier(0.34,1.56,0.64,1)',
        }} />
      </div>
      <div style={{ width: '36px', fontWeight: 800, fontSize: '0.95rem', color, textAlign: 'right', flexShrink: 0 }}>{value}</div>
    </div>
  );
}

// SVG sparkline area chart
function SparklineChart({ trend }: { trend: { date: string; count: number }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    if (containerRef.current) setWidth(containerRef.current.clientWidth);
    const obs = new ResizeObserver(e => setWidth(e[0].contentRect.width));
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const H = 110;
  const maxVal = Math.max(...trend.map(d => d.count), 1);
  const pts = trend.map((d, i) => {
    const x = (i / (trend.length - 1)) * width;
    const y = H - (d.count / maxVal) * (H - 12);
    return `${x},${y}`;
  });
  const areaPath = `M0,${H} L${pts.join(' L')} L${width},${H} Z`;
  const linePath = `M${pts.join(' L')}`;

  const recentTotal = trend.slice(-7).reduce((a, d) => a + d.count, 0);

  return (
    <div ref={containerRef}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Last {trend.length} days
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
            +{recentTotal} jobs last 7 days
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          <span>0</span>
          <span style={{ marginLeft: '4px' }}>max: {maxVal}</span>
        </div>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#sparkGrad)" />
        <path d={linePath} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {/* x-axis labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
        <span>{trend[0]?.date.slice(5)}</span>
        <span>{trend[Math.floor(trend.length / 2)]?.date.slice(5)}</span>
        <span>{trend[trend.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

function HistogramBar({ range, count, maxCount }: { range: string; count: number; maxCount: number }) {
  const rangeStart = parseInt(range.split('-')[0]);
  const color = rangeStart >= 80 ? '#10B981' : rangeStart >= 60 ? '#F59E0B' : '#EF4444';
  const [h, setH] = useState(0);
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  useEffect(() => { setTimeout(() => setH(pct), 100); }, [pct]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flex: 1 }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>{count || ''}</div>
      <div style={{ width: '100%', height: '80px', background: 'var(--color-bg)', borderRadius: '4px', display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
        <div style={{
          width: '100%', height: `${Math.max(h, count > 0 ? 3 : 0)}%`,
          background: color, borderRadius: '3px 3px 0 0',
          transition: 'height 0.7s cubic-bezier(0.34,1.56,0.64,1)',
        }} />
      </div>
      <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>{range}</div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { data: overview, isLoading } = useQuery<Overview>({
    queryKey: ['analytics_overview'],
    queryFn: async () => (await apiClient.get('/analytics/overview')).data,
    refetchInterval: 30_000,
  });
  const { data: scoreData } = useQuery<ScoreDist>({
    queryKey: ['analytics_scores'],
    queryFn: async () => (await apiClient.get('/analytics/score-distribution')).data,
  });
  const { data: trendData } = useQuery<Trend>({
    queryKey: ['analytics_trend'],
    queryFn: async () => (await apiClient.get('/analytics/trend')).data,
    refetchInterval: 60_000,
  });
  const { data: budgetData } = useQuery<Budget>({
    queryKey: ['analytics_budget'],
    queryFn: async () => (await apiClient.get('/analytics/budget-breakdown')).data,
  });
  const { data: skillsData } = useQuery<TopSkills>({
    queryKey: ['analytics_skills'],
    queryFn: async () => (await apiClient.get('/analytics/top-skills')).data,
  });

  const animatedTotal = useAnimatedValue(overview?.total_analyzed ?? 0);
  const animatedScore = useAnimatedValue(overview?.avg_match_score ?? 0);

  const conversionRate = overview && overview.applied > 0 && overview.total_analyzed > 0
    ? ((overview.applied / overview.total_analyzed) * 100).toFixed(1)
    : '0.0';

  const maxSkillCount = Math.max(...(skillsData?.skills.map(s => s.count) ?? [1]));

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: '16px', color: 'var(--color-text-muted)' }}>
        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
        <Activity size={32} color="var(--color-accent)" style={{ animation: 'spin 2s linear infinite' }} />
        <span>Loading analytics…</span>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Header */}
      <div style={{ animation: 'fadeUp 0.4s ease both' }}>
        <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-text)' }}>Analytics</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          Real-time performance metrics from your AI job copilot
        </p>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', animation: 'fadeUp 0.4s ease 0.05s both' }}>
        <KpiCard icon={<Activity size={18} color="var(--color-accent)" />} label="Jobs Analyzed" value={animatedTotal} accent="var(--color-accent)" />
        <KpiCard icon={<Target size={18} color="#10B981" />} label="Shortlisted" value={overview?.shortlisted ?? 0} sub={`${overview?.total_analyzed ? ((overview.shortlisted / overview.total_analyzed) * 100).toFixed(0) : 0}% of total`} accent="#10B981" />
        <KpiCard icon={<CheckCircle size={18} color="#F59E0B" />} label="Applied" value={overview?.applied ?? 0} sub={`${conversionRate}% conversion`} accent="#F59E0B" />
        <KpiCard icon={<Award size={18} color="#a78bfa" />} label="Hired" value={overview?.hired ?? 0} accent="#a78bfa" />
        <KpiCard icon={<BarChart2 size={18} color="var(--color-accent)" />} label="Avg Match Score" value={`${animatedScore}%`} sub={`Best: ${overview?.max_match_score ?? 0}%`} accent="var(--color-accent)" />
        <KpiCard icon={<Clock size={18} color="#64748b" />} label="Ignored / Skipped" value={overview?.ignored ?? 0} accent="#64748b" />
      </div>

      {/* Trend + Budget row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '14px', animation: 'fadeUp 0.4s ease 0.1s both' }}>

        {/* Trend sparkline */}
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderTop: '2px solid var(--color-accent)', borderRadius: '12px', padding: '20px 24px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <TrendingUp size={17} color="var(--color-accent)" />
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Job Intake Trend</span>
          </div>
          {trendData ? <SparklineChart trend={trendData.trend} /> : (
            <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>No trend data yet</div>
          )}
        </div>

        {/* Budget breakdown */}
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderTop: '2px solid #10B981', borderRadius: '12px', padding: '20px 24px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
            <Briefcase size={17} color="#10B981" />
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Budget Types</span>
          </div>
          {budgetData ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <AnimatedBar label="Hourly" value={budgetData.hourly.count} total={budgetData.hourly.count + budgetData.fixed.count} color="#10B981" />
              <AnimatedBar label="Fixed" value={budgetData.fixed.count} total={budgetData.hourly.count + budgetData.fixed.count} color="var(--color-accent)" />
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {budgetData.hourly.avg_min > 0 && <span>Avg hourly: ${budgetData.hourly.avg_min.toFixed(0)}–${budgetData.hourly.avg_max.toFixed(0)}/hr</span>}
                {budgetData.fixed.avg > 0 && <span>Avg fixed: ${budgetData.fixed.avg.toFixed(0)}</span>}
              </div>
            </div>
          ) : <div style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem' }}>No budget data yet</div>}
        </div>
      </div>

      {/* Funnel + Score distribution row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', animation: 'fadeUp 0.4s ease 0.15s both' }}>

        {/* Application funnel */}
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderTop: '2px solid #F59E0B', borderRadius: '12px', padding: '20px 24px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
            <Zap size={17} color="#F59E0B" />
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Application Funnel</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <FunnelStep label="Analyzed" value={overview?.total_analyzed ?? 0} max={overview?.total_analyzed ?? 1} color="var(--color-text-muted)" />
            <FunnelStep label="Shortlisted" value={overview?.shortlisted ?? 0} max={overview?.total_analyzed ?? 1} color="var(--color-accent)" />
            <FunnelStep label="Applied" value={overview?.applied ?? 0} max={overview?.total_analyzed ?? 1} color="#F59E0B" />
            <FunnelStep label="Interviewing" value={overview?.interviewing ?? 0} max={overview?.total_analyzed ?? 1} color="#10B981" />
            <FunnelStep label="Hired" value={overview?.hired ?? 0} max={overview?.total_analyzed ?? 1} color="#a78bfa" />
          </div>
        </div>

        {/* Match score distribution */}
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderTop: '2px solid var(--color-accent)', borderRadius: '12px', padding: '20px 24px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
            <BarChart2 size={17} color="var(--color-accent)" />
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Match Score Tiers</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <AnimatedBar label="🟢 High Match (80%+)" value={overview?.match_distribution.high ?? 0} total={overview?.total_analyzed ?? 1} color="#10B981" />
            <AnimatedBar label="🟡 Medium (60–79%)" value={overview?.match_distribution.medium ?? 0} total={overview?.total_analyzed ?? 1} color="#F59E0B" />
            <AnimatedBar label="🔴 Low (<60%)" value={overview?.match_distribution.low ?? 0} total={overview?.total_analyzed ?? 1} color="#EF4444" />
          </div>
        </div>
      </div>

      {/* Top Skills */}
      {skillsData && skillsData.skills.length > 0 && (
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderTop: '2px solid #a78bfa', borderRadius: '12px', padding: '20px 24px',
          animation: 'fadeUp 0.4s ease 0.2s both',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
            <Award size={17} color="#a78bfa" />
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Top Requested Skills</span>
            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginLeft: '4px' }}>across all job postings</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {skillsData.skills.map(({ skill, count }) => {
              const pct = (count / maxSkillCount) * 100;
              return (
                <div key={skill} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '110px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text)', textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill}</div>
                  <div style={{ flex: 1, height: '20px', background: 'var(--color-bg)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #a78bfa, #7c3aed)', borderRadius: '4px', transition: 'width 0.8s ease' }} />
                  </div>
                  <div style={{ width: '28px', fontSize: '0.8rem', color: 'var(--color-text-muted)', textAlign: 'right', flexShrink: 0 }}>{count}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Score Histogram */}
      {scoreData && (
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderTop: '2px solid var(--color-accent)', borderRadius: '12px', padding: '20px 24px',
          animation: 'fadeUp 0.4s ease 0.25s both',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
            <BarChart2 size={17} color="var(--color-accent)" />
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Score Histogram</span>
            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginLeft: '4px' }}>{scoreData.total} jobs with scores</span>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end', height: '120px' }}>
            {Object.entries(scoreData.buckets).map(([range, count]) => (
              <HistogramBar
                key={range}
                range={range}
                count={count}
                maxCount={Math.max(...Object.values(scoreData.buckets), 1)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}