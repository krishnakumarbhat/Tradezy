import { NextResponse } from 'next/server';

const payload = {
  app: {
    name: 'Wilson Research OS',
    tagline: 'AI-powered financial research cockpit',
    description:
      'Plan, validate, and monitor research workflows with an operator-friendly interface and realtime signals.',
  },
  stats: [
    { label: 'Live Signals', value: '128', trend: '+14 today' },
    { label: 'Automations', value: '32', trend: '+3 this week' },
    { label: 'Avg. Response', value: '1.8s', trend: '-0.2s faster' },
    { label: 'Success Rate', value: '98.4%', trend: '+1.1%' },
  ],
  services: [
    {
      id: 'svc-1',
      title: 'Market Pulse',
      category: 'Signal Engine',
      summary: 'Tracks unusual volume, sudden volatility, and institutional flow shifts in real-time.',
      status: 'healthy',
    },
    {
      id: 'svc-2',
      title: 'Filing Analyzer',
      category: 'Document AI',
      summary: 'Parses reports and earnings documents into structured, searchable insights.',
      status: 'healthy',
    },
    {
      id: 'svc-3',
      title: 'Risk Guard',
      category: 'Safety Layer',
      summary: 'Runs pre-trade checks and policy validation before strategy execution.',
      status: 'degraded',
    },
  ],
  timeline: [
    { time: '09:15', event: 'Portfolio monitor started daily run' },
    { time: '09:17', event: 'Detected 4 high-conviction momentum signals' },
    { time: '09:22', event: 'Earnings parser completed with confidence 96%' },
    { time: '09:30', event: 'Risk guard blocked 1 overexposed strategy' },
  ],
  popups: [
    {
      key: 'quick-action',
      title: 'Quick Actions',
      text: 'Open common tasks instantly: run scan, validate thesis, or draft summary.',
      actions: ['Run scan', 'Validate thesis', 'Draft summary'],
    },
    {
      key: 'system-health',
      title: 'System Health',
      text: 'View subsystem status and recent incidents in one place before execution.',
      actions: ['Open status board', 'Inspect incidents', 'Export report'],
    },
    {
      key: 'guided-tour',
      title: 'Guided Tour',
      text: 'Learn the workflow in under 2 minutes with an interactive onboarding path.',
      actions: ['Start tour', 'Skip intro', 'Watch demo'],
    },
  ],
};

export async function GET() {
  return NextResponse.json(payload);
}
