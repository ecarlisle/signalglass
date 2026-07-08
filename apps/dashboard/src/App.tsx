import analysis from './fixtures/sample-analysis.json' with { type: 'json' };

interface TokenBreakdown {
  sourceType: string;
  tokens: number;
  blockCount: number;
  percentage: number;
}

interface Smell {
  id: string;
  severity: 'info' | 'warning' | 'high';
  title: string;
  isHeuristic?: boolean;
  whatHappened: string;
  whyItMatters: string;
  evidenceSummary: string;
  recommendation: string;
  suggestedNextSteps: string[];
}

interface Recommendation {
  id: string;
  title: string;
  description: string;
  whyItMatters: string;
  inspectSuggestion: string;
  trySuggestion: string;
}

interface AnalysisShape {
  runName: string;
  model?: string;
  provider?: string;
  totalInputTokens: number;
  turnCount: number;
  blockCount: number;
  duplicateRatio: number;
  tokensBySourceType: TokenBreakdown[];
  smells: Smell[];
  recommendations: Recommendation[];
}

const sections = [
  'Run Summary',
  'Context Timeline',
  'Token Breakdown',
  'Context Smells',
  'Evidence Drawer',
  'Recommendations',
  'Run/Model Comparison',
];

const severityColor: Record<string, string> = {
  info: '#1976d2',
  warning: '#f57c00',
  high: '#d32f2f',
};

export default function App() {
  const a = analysis as unknown as AnalysisShape;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>SignalGlass Dashboard</h1>
      <p>
        {a.runName} · {a.model ?? 'unknown model'} · {a.provider ?? 'unknown provider'}
      </p>

      <nav
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 24,
          padding: 12,
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}
      >
        {sections.map((section) => (
          <span
            key={section}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              background: '#f0f0f0',
              color: '#444',
              fontSize: 13,
            }}
          >
            {section}
          </span>
        ))}
      </nav>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 16,
        }}
      >
        {[
          { label: 'Estimated input tokens', value: a.totalInputTokens },
          { label: 'Turns', value: a.turnCount },
          { label: 'Blocks', value: a.blockCount },
          { label: 'Repeated context', value: `${Math.round(a.duplicateRatio * 100)}%` },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              background: '#fff',
              padding: 16,
              borderRadius: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700 }}>{card.value}</div>
            <div style={{ color: '#666' }}>{card.label}</div>
          </div>
        ))}
      </div>

      <h2>Top source types</h2>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}
      >
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Type</th>
            <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Tokens</th>
            <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {a.tokensBySourceType.map((b) => (
            <tr key={b.sourceType} style={{ borderBottom: '1px solid #e0e0e0' }}>
              <td style={{ padding: '0.6rem 0.75rem' }}>{b.sourceType}</td>
              <td style={{ padding: '0.6rem 0.75rem' }}>{b.tokens}</td>
              <td style={{ padding: '0.6rem 0.75rem' }}>
                {Math.round(b.percentage * 100)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Context smells ({a.smells.length})</h2>
      {a.smells.map((s) => (
        <div
          key={s.id}
          style={{
            background: '#fff',
            padding: 16,
            borderRadius: 8,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            borderLeft: `4px solid ${severityColor[s.severity]}`,
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            [{s.severity.toUpperCase()}] {s.title}
            {s.isHeuristic && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: '#666',
                  border: '1px solid #ccc',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                heuristic
              </span>
            )}
          </div>
          <SmellField label="What happened" value={s.whatHappened} />
          <SmellField label="Why it matters" value={s.whyItMatters} />
          <SmellField label="Evidence" value={s.evidenceSummary} />
          <SmellField label="Recommendation" value={s.recommendation} />
          {s.suggestedNextSteps.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, color: '#444' }}>Try next</div>
              <ul style={{ margin: '4px 0 0 0', paddingLeft: 20, color: '#555' }}>
                {s.suggestedNextSteps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}

      <h2>Recommendations</h2>
      {a.recommendations.map((r) => (
        <div
          key={r.id}
          style={{
            background: '#fff',
            padding: 16,
            borderRadius: 8,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            borderLeft: '4px solid #1976d2',
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{r.title}</div>
          <p style={{ margin: '4px 0', color: '#444' }}>{r.description}</p>
          <SmellField label="Why it matters" value={r.whyItMatters} />
          <SmellField label="Inspect" value={r.inspectSuggestion} />
          <SmellField label="Try" value={r.trySuggestion} />
        </div>
      ))}

      <footer style={{ marginTop: 32, color: '#888', fontSize: 14 }}>
        Token counts are approximate estimates. Heuristic detections are labeled and should be verified against the raw run data.
      </footer>
    </div>
  );
}

function SmellField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginTop: 6 }}>
      <span style={{ fontWeight: 600, color: '#444' }}>{label}: </span>
      <span style={{ color: '#555' }}>{value}</span>
    </div>
  );
}
