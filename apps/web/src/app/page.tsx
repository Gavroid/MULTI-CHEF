// MC-001 smoke landing page. Real home / marketing screens land in MC-030+
// (see ADR-0007 / DEVELOPMENT-PLAN §0).
export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', margin: 0 }}>MULTI-CHEF</h1>
      <p style={{ marginTop: '0.5rem', color: '#555' }}>scaffold (MC-001)</p>
    </main>
  );
}
