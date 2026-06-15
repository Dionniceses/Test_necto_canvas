// Cockpit — single-screen admin overview.
// Middle-ground between the dense hub view and the zoomed-in flow detail:
// the topology shows the most-trafficked integrations by name and groups
// the long tail into category clusters. KPI tiles up top, a live signal
// feed on the right, timeline scrubber on the bottom.

// ---------- Cockpit data ---------------------------------------------------
// Tenants — picked from the org switcher. `color` is the visual ref we use
// everywhere a tenant needs to be distinguished (chips, dots, event rows).
const TENANTS = [
  { id: 'emendis-prod', label: 'emendis · prod',    color: '#e5247d' },
  { id: 'emendis-stg',  label: 'emendis · staging', color: '#3a6ff0' },
  { id: 'acme-prod',    label: 'acme · prod',       color: '#1f8a5b' },
  { id: 'acme-stg',     label: 'acme · staging',    color: '#b07a16' },
  { id: 'nordic-prod',  label: 'nordic · prod',     color: '#7d55e0' },
];
const TENANT_BY_ID = Object.fromEntries(TENANTS.map(t => [t.id, t]));

const CK = {
  // Headline metrics for the KPI strip.
  kpis: [
    { label: 'Integrations',  value: '47',     trend: '+3 this wk', tone: 'neutral' },
    { label: 'Req / min',     value: '1,247',  trend: '↑ 12% vs 1h', tone: 'good' },
    { label: 'Error rate',    value: '0.34%',  trend: '↑ 0.21pp',    tone: 'bad'  },
    { label: 'p50 latency',   value: '184 ms', trend: '↓ 8 ms',      tone: 'good' },
    { label: 'Uptime · 30d',  value: '99.97%', trend: 'SLO 99.9%',   tone: 'good' },
  ],

  // Every HTTP target Neqto talks to. Flat list — no grouping.
  // ring picks placement radius; status drives chip border / pulse mix.
  named: [
    // Inner ring — most active / hottest integrations
    { id: 'bol.com',     ring: 0, rate: 30,  status: 'red',   highlight: true, badge: '500' },
    { id: 'AFAS',        ring: 0, rate: 2,   status: 'red',   highlight: true },
    { id: 'WAF',         ring: 0, rate: 30,  status: 'amber', isGateway: true },
    { id: 'Auth0',       ring: 0, rate: 26,  status: 'green' },
    { id: 'Stripe',      ring: 0, rate: 22,  status: 'green' },
    { id: 'Microsoft',   ring: 0, rate: 18,  status: 'green' },
    { id: 'Adyen',       ring: 0, rate: 14,  status: 'green' },
    { id: 'Google',      ring: 0, rate: 14,  status: 'green' },
    { id: 'PostNL',      ring: 0, rate: 11,  status: 'green' },
    { id: 'Salesforce',  ring: 0, rate: 9,   status: 'green' },

    // Middle ring
    { id: 'Twinfield',   ring: 1, rate: 1.5, status: 'amber' },
    { id: 'Shopify',     ring: 1, rate: 18,  status: 'green' },
    { id: 'Amazon',      ring: 1, rate: 12,  status: 'green' },
    { id: 'Okta',        ring: 1, rate: 9,   status: 'green' },
    { id: 'Sendgrid',    ring: 1, rate: 8,   status: 'green' },
    { id: 'Snowflake',   ring: 1, rate: 7,   status: 'green' },
    { id: 'HubSpot',     ring: 1, rate: 6,   status: 'green' },
    { id: 'Mollie',      ring: 1, rate: 6,   status: 'green' },
    { id: 'Fastly',      ring: 1, rate: 6,   status: 'green' },
    { id: 'SAP',         ring: 1, rate: 6,   status: 'green' },
    { id: 'Slack',       ring: 1, rate: 5,   status: 'green' },
    { id: 'Atlassian',   ring: 1, rate: 5,   status: 'green' },
    { id: 'DHL',         ring: 1, rate: 8,   status: 'green' },
    { id: 'Sentry',      ring: 1, rate: 4,   status: 'amber' },
    { id: 'Intercom',    ring: 1, rate: 4,   status: 'green' },
    { id: 'Teams',       ring: 1, rate: 4,   status: 'green' },
    { id: 'Exact',       ring: 1, rate: 4,   status: 'green' },
    { id: 'PayPal',      ring: 1, rate: 4,   status: 'green' },

    // Outer ring — long tail
    { id: 'GitHub',      ring: 2, rate: 3,   status: 'green' },
    { id: 'Twilio',      ring: 2, rate: 3,   status: 'green' },
    { id: 'Oracle',      ring: 2, rate: 3,   status: 'green' },
    { id: 'Onedrive',    ring: 2, rate: 3,   status: 'green' },
    { id: 'FedEx',       ring: 2, rate: 5,   status: 'green' },
    { id: 'GitLab',      ring: 2, rate: 2,   status: 'green' },
    { id: 'UPS',         ring: 2, rate: 4,   status: 'green' },
    { id: 'Xero',        ring: 2, rate: 2,   status: 'green' },
    { id: 'Mailchimp',   ring: 2, rate: 2,   status: 'green' },
    { id: 'Coolblue',    ring: 2, rate: 3,   status: 'green' },
    { id: 'Dropbox',     ring: 2, rate: 2,   status: 'green' },
    { id: 'AWS',         ring: 2, rate: 9,   status: 'green' },
    { id: 'PagerDuty',   ring: 2, rate: 1,   status: 'green' },
    { id: 'Notion',      ring: 2, rate: 1,   status: 'green' },
    { id: 'Zalando',     ring: 2, rate: 4,   status: 'green' },
    { id: 'Zoom',        ring: 2, rate: 1,   status: 'green' },
  ],

  // Per-integration detail (selected pane). We model what the PoC can capture
  // per egress request: status, flow, ttfb, payload + response sizes, time.
  details: {
    AFAS: {
      errorRate: 37.4,
      processed30m: 382,
      events: [
        { id: '1779361895312444', http: 204, flow: 'customer-sync',  t: '13:11:35', tenant: 'emendis-prod' },
        { id: '1779361893797391', http: 404, flow: 'customer-sync',  t: '13:11:33', err: true, tenant: 'acme-prod' },
        { id: '1779361887723179', http: 429, flow: 'customer-sync',  t: '13:11:27', err: true, open: true,
          ttfb: 580, payload: 490, response: 2200, tenant: 'emendis-prod' },
        { id: '1779361879256755', http: 404, flow: 'customer-sync',  t: '13:11:19', err: true, tenant: 'emendis-prod' },
        { id: '1779361873418002', http: 204, flow: 'customer-sync',  t: '13:11:13', tenant: 'acme-prod' },
        { id: '1779361865901733', http: 500, flow: 'order-sync',     t: '13:11:05', err: true, tenant: 'emendis-prod' },
        { id: '1779361859214456', http: 204, flow: 'customer-sync',  t: '13:10:59', tenant: 'acme-prod' },
        { id: '1779361851287342', http: 200, flow: 'invoice-sync',   t: '13:10:51', tenant: 'emendis-prod' },
        { id: '1779361842890011', http: 204, flow: 'customer-sync',  t: '13:10:42', tenant: 'acme-prod' },
        { id: '1779361836550918', http: 429, flow: 'customer-sync',  t: '13:10:36', err: true, tenant: 'emendis-prod' },
        { id: '1779361828119772', http: 200, flow: 'invoice-sync',   t: '13:10:28', tenant: 'acme-prod' },
        { id: '1779361820471155', http: 204, flow: 'customer-sync',  t: '13:10:20', tenant: 'emendis-prod' },
      ],
    },
    'bol.com': {
      errorRate: 8.2,
      processed30m: 1842,
      events: [
        { id: '1779361912043388', http: 200, flow: 'order-import',   t: '13:11:52', tenant: 'emendis-prod' },
        { id: '1779361910218947', http: 500, flow: 'order-import',   t: '13:11:50', err: true, open: true,
          ttfb: 1240, payload: 320, response: 0, tenant: 'emendis-prod' },
        { id: '1779361908412218', http: 200, flow: 'order-import',   t: '13:11:48', tenant: 'acme-prod' },
        { id: '1779361906701839', http: 200, flow: 'stock-sync',     t: '13:11:46', tenant: 'emendis-prod' },
        { id: '1779361904983311', http: 200, flow: 'order-import',   t: '13:11:44', tenant: 'acme-prod' },
      ],
    },
  },
};

// Build a generic detail object for any node we don't have hand-crafted data for.
function defaultDetail(name) {
  const seed = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const errs = (seed % 17) / 10;            // 0.0–1.6%
  const processed = 80 + (seed % 400);
  const flows = ['customer-sync', 'order-sync', 'invoice-sync'];
  const events = Array.from({ length: 10 }).map((_, i) => ({
    id: String(1779361800000000 + seed * 1000 + i * 137),
    http: 200,
    flow: flows[(seed + i) % flows.length],
    t: `13:${String(11 - Math.floor(i / 2)).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}`,
  }));
  return { errorRate: errs, processed30m: processed, events };
}

// Triggered signals (flow-raised events) that lit up across the system.
// Newest first. level matches the Signals app: error / warning / info / ok.
// `scrub` is the 0–1 position on the bottom timeline so we can drop a
// matching marker.
CK.signals = [
  { t: '13:11:35', scrub: 0.882, level: 'error',   id: 'afas-throttled',
    name: 'AFAS throttled', group: 'System',     source: 'customer-sync',
    detail: 'HTTP 429 from /soap/import · 3rd in 5 min' },
  { t: '13:08:14', scrub: 0.864, level: 'warning', id: 'stock-low',
    name: 'Stock low',      group: 'Operations', source: 'inventory-watcher',
    detail: 'SKU-2298 below re-order point' },
  { t: '12:54:02', scrub: 0.795, level: 'error',   id: 'bol-500',
    name: 'Order import failed', group: 'Sales',  source: 'order-import',
    detail: 'HTTP 500 on order-12 · upstream timeout' },
  { t: '12:31:47', scrub: 0.679, level: 'ok',      id: 'invoice-accepted',
    name: 'Invoice accepted', group: 'Sales',    source: 'ledger-watcher',
    detail: 'INV-2025-1141 paid by Brightline Labs' },
  { t: '11:48:09', scrub: 0.452, level: 'warning', id: 'invoice-overdue',
    name: 'Invoice overdue > 14d', group: 'Sales', source: 'finance-ledger-watcher',
    detail: 'INV-2025-1117 · Atlas Freight B.V. · 15 days' },
  { t: '09:22:01', scrub: 0.155, level: 'info',    id: 'deal-stalled',
    name: 'Deal stalled',   group: 'Sales',      source: 'crm-watcher',
    detail: 'Opportunity #4471 idle 21d' },
  { t: '04:11:55', scrub: 0.041, level: 'error',   id: 'aws-offline',
    name: 'AWS offline',    group: 'System',     source: 'health-probe',
    detail: 'eu-west-1 · elb 503 · 8m before recovery' },
];

// Map an HTTP status code to the pulse colour the user requested:
//   2xx → green · 3xx & 1xx → amber/yellow · 4xx & 5xx → red.
function statusColor(http) {
  if (http >= 400) return NQ.red;
  if (http >= 300) return NQ.amber;
  if (http >= 200) return NQ.green;
  return                NQ.amber; // 1xx
}

// Deterministic per-pulse HTTP status, biased by the edge's overall health.
function pulseStatus(edgeStatus, seed) {
  const mixes = {
    red:    [500, 429, 502, 200, 404, 500, 301],
    amber:  [200, 200, 429, 200, 301, 200, 503],
    green:  [200, 200, 200, 204, 200, 301, 200],
  };
  const arr = mixes[edgeStatus] || mixes.green;
  return arr[seed % arr.length];
}

function signalTone(level) {
  if (level === 'error')   return { c: NQ.red,   icon: 'alert' };
  if (level === 'warning') return { c: NQ.amber, icon: 'alert' };
  if (level === 'ok')      return { c: NQ.green, icon: 'check' };
  return                          { c: NQ.blue,  icon: 'signal' };
}

// ---------- Page shell -----------------------------------------------------
function CockpitPage() {
  const [paused, setPaused]   = React.useState(false);
  // Multi-select tenant. Defaults to two selected so the multi-tenant UX is
  // visible at first load.
  const [selectedTenants, setSelectedTenants] = React.useState(['emendis-prod', 'acme-prod']);
  const [date,   setDate]     = React.useState('05/01/2026');
  const [scrub,  setScrub]    = React.useState(0.92);
  const [speed,  setSpeed]    = React.useState(1);
  // Default to AFAS selected with one open request, so the detail surface
  // is visible without interaction.
  const [selected, setSelected] = React.useState('AFAS');
  const [openRequest, setOpenRequest] = React.useState(
    (CK.details.AFAS.events.find(e => e.open)) || null
  );

  const time = React.useMemo(() => {
    const mins = Math.round(scrub * (24 * 60 - 1));
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }, [scrub]);

  return (
    <NqFrame active="cockpit" title="Cockpit" topbarRight={
      <div style={{ display: 'flex', gap: 8 }}>
        <NqBtn kind="ghost" size="sm" icon="rotate" style={{ color: NQ.textMid }}>Replay</NqBtn>
        <NqBtn kind="ghost" size="sm" icon="external" style={{ color: NQ.textMid }}>Open in Signals</NqBtn>
      </div>
    }>
      <div style={{
        position: 'relative', height: '100%',
        background: '#fff', border: `1px solid ${NQ.border}`,
        borderRadius: 8, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <CockpitHeader
          selectedTenants={selectedTenants} setSelectedTenants={setSelectedTenants}
          paused={paused} onPauseToggle={() => setPaused(p => !p)}
        />
        <KpiStrip/>
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <TopologyPane
            paused={paused}
            selected={selected}
            onSelect={(id) => { setSelected(id); setOpenRequest(null); }}
            openRequest={openRequest}
            onCloseRequest={() => setOpenRequest(null)}
            selectedTenants={selectedTenants}
          />
          <SidePanel
            paused={paused}
            selected={selected}
            onSelectNode={(id) => setSelected(id)}
            onCloseSelection={() => { setSelected(null); setOpenRequest(null); }}
            onOpenRequest={(ev) => setOpenRequest(ev)}
            openRequest={openRequest}
            selectedTenants={selectedTenants}
          />
        </div>
        <CockpitTimeline
          date={date} setDate={setDate}
          scrub={scrub} setScrub={setScrub} time={time}
          speed={speed} setSpeed={setSpeed}
        />
      </div>
    </NqFrame>
  );
}

// ---------- Header (tenant + live cluster) ---------------------------------
function CockpitHeader({ selectedTenants, setSelectedTenants, paused, onPauseToggle }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 20px',
      borderBottom: `1px solid ${NQ.border}`,
      background: '#fff',
    }}>
      <CockpitTenantSelect value={selectedTenants} onChange={setSelectedTenants}/>
      <span style={{ flex: 1 }}/>
      <CockpitLiveBar paused={paused} onPauseToggle={onPauseToggle}/>
    </div>
  );
}

function CockpitTenantSelect({ value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (id) => {
    if (value.includes(id)) {
      // Don't allow zero selection
      if (value.length === 1) return;
      onChange(value.filter(v => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const selected = value.map(id => TENANT_BY_ID[id]).filter(Boolean);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'stretch',
        background: '#fff',
        border: `1px solid ${open ? NQ.pink : NQ.border}`,
        borderRadius: 7,
        overflow: 'hidden',
        boxShadow: open ? `0 0 0 3px ${NQ.pink}14` : 'none',
      }}>
        <span style={{
          padding: '0 10px', display: 'flex', alignItems: 'center',
          color: NQ.textDim, background: NQ.pageBg,
          borderRight: `1px solid ${NQ.border}`, fontSize: 10,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 600,
        }}>
          Tenants
        </span>
        <button onClick={() => setOpen(o => !o)} style={{
          all: 'unset', padding: '6px 10px 6px 10px',
          display: 'flex', alignItems: 'center', gap: 8,
          cursor: 'pointer', minWidth: 220,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' }}>
            {selected.slice(0, 2).map(t => <TenantPill key={t.id} t={t}/>)}
            {selected.length > 2 && (
              <span style={{
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 11, fontWeight: 700, color: NQ.textMid,
                padding: '2px 6px', borderRadius: 4, background: NQ.pageBg,
              }}>
                +{selected.length - 2}
              </span>
            )}
          </div>
          <NqIcon name="chevronDown" size={13} color={NQ.textMid}
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}/>
        </button>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          minWidth: 280,
          background: '#fff',
          border: `1px solid ${NQ.border}`,
          borderRadius: 8,
          boxShadow: '0 8px 32px rgba(20,25,38,0.12)',
          zIndex: 20,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '8px 12px 6px',
            display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: `1px solid ${NQ.border}`,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
              textTransform: 'uppercase', color: NQ.textDim,
              flex: 1,
            }}>
              Show traffic for
            </span>
            <button onClick={() => onChange(TENANTS.map(t => t.id))} style={{
              all: 'unset', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, color: NQ.pink,
            }}>
              All
            </button>
            <button onClick={() => onChange([value[0] || TENANTS[0].id])} style={{
              all: 'unset', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, color: NQ.textMid,
            }}>
              Reset
            </button>
          </div>
          {TENANTS.map(t => {
            const on = value.includes(t.id);
            const last = on && value.length === 1;
            return (
              <button key={t.id}
                onClick={() => toggle(t.id)}
                disabled={last}
                title={last ? 'At least one tenant must remain selected' : ''}
                style={{
                  all: 'unset', display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', boxSizing: 'border-box',
                  padding: '8px 12px',
                  cursor: last ? 'not-allowed' : 'pointer',
                  background: on ? '#fff7fb' : '#fff',
                  borderBottom: `1px solid ${NQ.border}`,
                  opacity: last ? 0.65 : 1,
                }}>
                <span style={{
                  width: 16, height: 16, borderRadius: 4,
                  border: `1.5px solid ${on ? NQ.pink : NQ.borderStrong}`,
                  background: on ? NQ.pink : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', flexShrink: 0,
                }}>
                  {on && <NqIcon name="check" size={10}/>}
                </span>
                <span style={{
                  width: 10, height: 10, borderRadius: 6,
                  background: t.color, flexShrink: 0,
                }}/>
                <span style={{
                  fontSize: 12.5, fontWeight: 600, color: NQ.text, flex: 1,
                }}>
                  {t.label}
                </span>
                <span style={{
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  fontSize: 10, color: NQ.textDim,
                }}>
                  {t.id}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Small tenant pill — used inside the multi-select trigger.
function TenantPill({ t, size = 'sm' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: size === 'sm' ? '2px 6px 2px 5px' : '3px 8px 3px 6px',
      background: '#fff',
      border: `1px solid ${NQ.border}`,
      borderRadius: 999,
      fontSize: size === 'sm' ? 11 : 12,
      fontWeight: 600, color: NQ.text,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: t.color }}/>
      {t.label}
    </span>
  );
}

function CockpitLiveBar({ paused, onPauseToggle }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 0,
      background: '#fff',
      border: `1px solid ${NQ.border}`,
      borderRadius: 7,
      overflow: 'hidden',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>
      <span style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 12px',
        color: paused ? NQ.textDim : NQ.green,
        fontSize: 11, fontWeight: 700, letterSpacing: 0.8,
        borderRight: `1px solid ${NQ.border}`,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: 4,
          background: paused ? NQ.textDim : NQ.green,
          boxShadow: paused ? 'none' : `0 0 0 3px ${NQ.green}26`,
        }}/>
        {paused ? 'PAUSED' : 'LIVE'}
      </span>
      <button onClick={onPauseToggle} style={{
        all: 'unset', padding: '8px 12px',
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 700, color: NQ.pink,
        cursor: 'pointer',
        background: paused ? NQ.pinkSoft : 'transparent',
      }}>
        <NqIcon name={paused ? 'play' : 'pause'} size={11}/>
        {paused ? 'Resume' : 'Pause'}
      </button>
    </div>
  );
}

// ---------- KPI strip ------------------------------------------------------
function KpiStrip() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${CK.kpis.length}, 1fr)`,
      borderBottom: `1px solid ${NQ.border}`,
      background: NQ.pageBg,
    }}>
      {CK.kpis.map((k, i) => (
        <div key={i} style={{
          padding: '12px 18px',
          borderRight: i < CK.kpis.length - 1 ? `1px solid ${NQ.border}` : 'none',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
            textTransform: 'uppercase', color: NQ.textDim,
          }}>
            {k.label}
          </span>
          <span style={{
            fontSize: 22, fontWeight: 700, color: NQ.text,
            letterSpacing: -0.3, fontFamily: '"Inter Tight", ui-sans-serif',
          }}>
            {k.value}
          </span>
          <span style={{
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 10.5, fontWeight: 600, letterSpacing: 0.2,
            color: k.tone === 'good' ? NQ.green : k.tone === 'bad' ? NQ.red : NQ.textMid,
          }}>
            {k.trend}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Topology pane --------------------------------------------------
function TopologyPane({ paused, selected, onSelect, openRequest, onCloseRequest, selectedTenants }) {
  const wrapRef = React.useRef(null);
  const [size, setSize] = React.useState({ w: 800, h: 600 });

  React.useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const TICKER_H = 50;
  const cx = size.w / 2;
  const cy = (size.h - TICKER_H) / 2;
  // The available radius — leave room for chips to extend.
  const baseR = Math.min(size.w, size.h - TICKER_H) * 0.38;

  // Three concentric rings of integrations, placed by ring index.
  // Each ring's items are spread evenly with a phase offset + light jitter
  // so it doesn't read as a clockface.
  const ringRadii = [0.50, 0.78, 0.98];
  const ringPhase = [0.10, 0.28, 0.05];
  const ringJitter = [0.04, 0.05, 0.04];
  const allNodes = React.useMemo(() => {
    const byRing = [[], [], []];
    CK.named.forEach(n => byRing[n.ring].push(n));
    const aspect = (size.w / Math.max(1, size.h - TICKER_H)) > 1.15 ? 1.15 : 1;
    return byRing.flatMap((items, ringIdx) => {
      const rBase = ringRadii[ringIdx];
      const phase = ringPhase[ringIdx];
      return items.map((it, i) => {
        // even angular spread on the ring
        const t = ((i + 0.5) / items.length + phase) * 2 * Math.PI - Math.PI / 2;
        // deterministic per-item radius wiggle
        const seed = (i * 9301 + ringIdx * 4079) % 1000;
        const wiggle = (seed / 1000 - 0.5) * 2 * ringJitter[ringIdx];
        const r = rBase + wiggle;
        return {
          ...it,
          x: cx + Math.cos(t) * baseR * r * aspect,
          y: cy + Math.sin(t) * baseR * r,
        };
      });
    });
  }, [cx, cy, baseR, size.w, size.h]);

  // Build edge list — every integration connects to the core.
  const edges = allNodes.map(n => ({
    from: { x: n.x, y: n.y },
    to:   { x: cx, y: cy },
    rate: n.rate,
    status: n.status,
    highlight: n.highlight,
    id: n.id,
  }));

  return (
    <div ref={wrapRef} style={{
      flex: 1, position: 'relative', overflow: 'hidden',
      background: `radial-gradient(circle at 50% 50%, #fff 0%, #fafbfc 65%, #f4f5f7 100%)`,
    }}>
      {/* dot grid */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(rgba(28,31,36,0.06) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
        maskImage: 'radial-gradient(ellipse 70% 65% at 50% 50%, #000 25%, transparent 90%)',
        WebkitMaskImage: 'radial-gradient(ellipse 70% 65% at 50% 50%, #000 25%, transparent 90%)',
      }}/>

      {/* center halo + concentric rings */}
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="ckCenterGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={NQ.pink} stopOpacity="0.18"/>
            <stop offset="60%" stopColor={NQ.pink} stopOpacity="0.03"/>
            <stop offset="100%" stopColor={NQ.pink} stopOpacity="0"/>
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={170} fill="url(#ckCenterGlow)"/>
        {/* faint concentric ring */}
        <circle cx={cx} cy={cy} r={baseR * 0.55} fill="none"
          stroke={NQ.border} strokeWidth="1" strokeDasharray="2 5" opacity="0.6"/>
        <circle cx={cx} cy={cy} r={baseR * 0.92} fill="none"
          stroke={NQ.border} strokeWidth="1" strokeDasharray="2 5" opacity="0.4"/>

        {/* edges */}
        {edges.map((e, i) => {
          const color =
            e.status === 'red' ? NQ.red :
            e.status === 'amber' ? NQ.amber : NQ.pink;
          const opacity =
            e.status === 'red' ? 0.6 :
            e.status === 'amber' ? 0.5 :
            Math.min(0.45, 0.08 + e.rate / 80);
          // line width scales gently with rate
          const w = e.highlight ? 2.4 : Math.max(0.8, Math.min(2.4, 0.8 + e.rate / 20));
          return (
            <line key={`e-${i}`}
              x1={e.from.x} y1={e.from.y} x2={e.to.x} y2={e.to.y}
              stroke={color} strokeOpacity={opacity} strokeWidth={w}
              strokeDasharray={e.status === 'amber' ? '5 4' : ''}
            />
          );
        })}

        {/* pulses — always outbound (egress only) from core to integration.
            Each pulse represents a request; its colour reflects the HTTP
            status it carries (2xx green · 3xx/1xx amber · 4xx/5xx red). */}
        {!paused && edges.flatMap((e, i) => {
          // Pulses per edge scale gently with traffic; highlighted edges get +1.
          const n = Math.min(4, Math.max(1, Math.round((e.rate || 4) / 9))) + (e.highlight ? 1 : 0);
          const a = e.to;     // core
          const b = e.from;   // integration
          const out = [];
          for (let k = 0; k < n; k++) {
            const seed = i * 11 + k * 3;
            const dur = (1.6 + (seed % 7) * 0.3) + 's';
            const begin = (-((seed * 23) % 17) * 0.13) + 's';
            const http = pulseStatus(e.status, seed);
            const color = statusColor(http);
            out.push(
              <circle key={`p-${i}-${k}`} r={e.highlight ? 3 : 2.2} fill={color} opacity={0.95}>
                <animate attributeName="cx" values={`${a.x};${b.x}`} dur={dur} begin={begin} repeatCount="indefinite"/>
                <animate attributeName="cy" values={`${a.y};${b.y}`} dur={dur} begin={begin} repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur={dur} begin={begin} repeatCount="indefinite"/>
              </circle>
            );
          }
          return out;
        })}
      </svg>

      {/* node chips */}
      {allNodes.map(n => (
        <NodeChip key={n.id} node={n}
          selected={selected === n.id}
          onClick={() => onSelect(selected === n.id ? null : n.id)}
        />
      ))}

      {/* core */}
      <CenterNode x={cx} y={cy}/>

      {/* legend in corner */}
      <Legend/>

      {/* Recent signals strip — always visible, full-width along the bottom */}
      <SignalsTicker/>

      {/* Open request popover (anchored near upper-left, above the cluster bubbles) */}
      {openRequest && (
        <RequestPopover
          ev={openRequest}
          destination={selected || openRequest.dest || ''}
          onClose={onCloseRequest}
          multiTenant={selectedTenants && selectedTenants.length > 1}
          style={{ position: 'absolute', left: 20, top: 20, width: 320 }}
        />
      )}
    </div>
  );
}

function NodeChip({ node, selected, onClick }) {
  const color =
    node.status === 'red' ? NQ.red :
    node.status === 'amber' ? NQ.amber : NQ.green;
  const ring = selected ? NQ.pink : (node.highlight ? NQ.pink : NQ.border);
  const compact = !selected && !node.highlight;
  return (
    <button onClick={onClick}
      title={`${node.id} · ${node.rate}/min`}
      style={{
        all: 'unset', cursor: 'pointer',
        position: 'absolute', left: node.x, top: node.y,
        transform: 'translate(-50%, -50%)',
        display: 'flex', alignItems: 'center', gap: 6,
        padding: compact ? '3px 8px 3px 7px' : '4px 9px 4px 8px',
        background: '#fff',
        border: `1px solid ${ring}`,
        borderRadius: 999,
        boxShadow: selected
          ? `0 0 0 3px ${NQ.pink}22, 0 4px 12px rgba(229,36,125,0.18)`
          : (node.highlight
            ? `0 0 0 3px ${NQ.pink}14, 0 2px 6px rgba(20,25,38,0.06)`
            : '0 1px 2px rgba(20,25,38,0.05)'),
        whiteSpace: 'nowrap', userSelect: 'none',
      }}>
      <span style={{
        width: compact ? 6 : 7, height: compact ? 6 : 7, borderRadius: 5,
        background: color,
        boxShadow: node.status !== 'green' ? `0 0 0 2px ${color}22` : 'none',
      }}/>
      <span style={{
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: compact ? 10.5 : 11, fontWeight: 600, color: NQ.text,
      }}>
        {node.id}
      </span>
      {(selected || node.highlight) && (
        <span style={{
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 10, fontWeight: 700,
          color: NQ.textDim,
          padding: '1px 5px', borderRadius: 4,
          background: NQ.pageBg,
        }}>
          {node.rate}/m
        </span>
      )}
      {node.badge && (
        <span style={{
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 9.5, fontWeight: 700, color: '#fff',
          padding: '1px 5px', borderRadius: 4,
          background: NQ.red,
        }}>
          {node.badge}
        </span>
      )}
    </button>
  );
}

function CenterNode({ x, y }) {
  return (
    <div style={{
      position: 'absolute', left: x, top: y,
      transform: 'translate(-50%, -50%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      zIndex: 2, pointerEvents: 'none',
    }}>
      <div style={{
        width: 78, height: 78, borderRadius: 999,
        background: '#fff',
        border: `2px solid ${NQ.pink}`,
        boxShadow: `0 0 0 6px ${NQ.pink}10, 0 8px 24px rgba(229,36,125,0.18)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        <NqLogo size={36}/>
        <svg width={98} height={98} style={{ position: 'absolute', inset: -10, animation: 'cockpitRing 16s linear infinite' }}>
          <circle cx={49} cy={49} r={45} fill="none" stroke={NQ.pink} strokeOpacity="0.45" strokeWidth="1" strokeDasharray="2 6"/>
        </svg>
      </div>
      <span style={{
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 9.5, letterSpacing: 1.4, color: NQ.pink, fontWeight: 700,
      }}>
        NEQTO · CORE
      </span>
    </div>
  );
}

function Legend() {
  return (
    <div style={{
      position: 'absolute', right: 16, top: 16,
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '8px 10px',
      background: '#fff',
      border: `1px solid ${NQ.border}`,
      borderRadius: 6,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 9.5, letterSpacing: 0.4, color: NQ.textMid,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: NQ.textDim, fontWeight: 700 }}>NODES</span>
        <LegendDot c={NQ.green} l="HEALTHY"/>
        <LegendDot c={NQ.amber} l="DEGRADED"/>
        <LegendDot c={NQ.red}   l="FAILING"/>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: NQ.textDim, fontWeight: 700 }}>PULSES</span>
        <LegendDot c={NQ.green} l="2xx"/>
        <LegendDot c={NQ.amber} l="1xx · 3xx"/>
        <LegendDot c={NQ.red}   l="4xx · 5xx"/>
      </div>
    </div>
  );
}
function LegendDot({ c, l }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: c }}/>
      {l}
    </span>
  );
}

// ---------- Signals ticker (bottom strip of topology pane) -----------------
// Always-visible feed of recently triggered signals. Newest on the left.
function SignalsTicker() {
  const errs = CK.signals.filter(s => s.level === 'error').length;
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      background: '#fff',
      borderTop: `1px solid ${NQ.border}`,
      padding: '8px 14px',
      display: 'flex', alignItems: 'center', gap: 12,
      minHeight: 50,
    }}>
      {/* Label */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        paddingRight: 12, borderRight: `1px solid ${NQ.border}`,
      }}>
        <span style={{
          width: 26, height: 26, borderRadius: 6,
          background: NQ.pinkSoft, color: NQ.pink,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <NqIcon name="signal" size={14}/>
        </span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: NQ.text, letterSpacing: 0.3 }}>
            Signals
          </span>
          <span style={{
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 9.5, color: NQ.textDim, letterSpacing: 0.2,
          }}>
            {CK.signals.length} triggered · {errs} error
          </span>
        </div>
      </div>

      {/* Chips */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 8,
        overflow: 'hidden',
      }}>
        {CK.signals.slice(0, 6).map(s => <SignalChip key={s.id + s.t} s={s}/>)}
      </div>

      {/* View all */}
      <a style={{
        flexShrink: 0,
        fontSize: 11, fontWeight: 600, color: NQ.pink,
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
      }}>
        Open Signals
        <NqIcon name="arrowRight" size={11}/>
      </a>
    </div>
  );
}

function SignalChip({ s }) {
  const t = signalTone(s.level);
  return (
    <div title={s.detail} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '5px 10px 5px 8px',
      background: '#fff',
      border: `1px solid ${NQ.border}`,
      borderLeft: `3px solid ${t.c}`,
      borderRadius: 6,
      flexShrink: 0,
      cursor: 'pointer',
    }}>
      <span style={{
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 10, fontWeight: 700, color: NQ.textDim, letterSpacing: 0.3,
      }}>
        {s.t.slice(0, 5)}
      </span>
      <span style={{ width: 1, height: 14, background: NQ.border }}/>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: NQ.text, whiteSpace: 'nowrap' }}>
        {s.name}
      </span>
      <span style={{
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 9.5, fontWeight: 600, color: NQ.textDim, letterSpacing: 0.3,
        textTransform: 'uppercase',
      }}>
        {s.group}
      </span>
    </div>
  );
}

// ---------- Right side panel: contextual (selected node) -------------------
function SidePanel({ paused, selected, onSelectNode, onCloseSelection, onOpenRequest, openRequest, selectedTenants }) {
  const multiTenant = selectedTenants && selectedTenants.length > 1;
  return (
    <div style={{
      width: 340, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      background: '#fff',
      minHeight: 0,
      borderLeft: `1px solid ${NQ.border}`,
    }}>
      {selected ? (
        <IntegrationDetailPanel
          name={selected}
          paused={paused}
          openRequest={openRequest}
          onOpenRequest={onOpenRequest}
          onClose={onCloseSelection}
          selectedTenants={selectedTenants}
          multiTenant={multiTenant}
        />
      ) : (
        <AllIntegrationsPanel
          paused={paused}
          onSelectNode={onSelectNode}
        />
      )}
    </div>
  );
}

// ---------- Integration detail (right panel when a node is selected) -------
function IntegrationDetailPanel({ name, paused, openRequest, onOpenRequest, onClose, selectedTenants, multiTenant }) {
  const detail = CK.details[name] || defaultDetail(name);
  // Filter to the active tenant set so the numbers/lists reflect the dropdown.
  const events = (detail.events || []).filter(e => !e.tenant || !selectedTenants || selectedTenants.includes(e.tenant));
  const errorTone = detail.errorRate >= 5 ? NQ.red : detail.errorRate >= 1 ? NQ.amber : NQ.green;
  const errors = events.filter(e => e.err);

  return (
    <>
      {/* Pink banner — selected integration */}
      <div style={{
        background: NQ.pink, color: '#fff',
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: 5, background: '#fff', opacity: 0.9,
          boxShadow: '0 0 0 3px rgba(255,255,255,0.25)',
        }}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>{name}</div>
          <div style={{
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 10.5, opacity: 0.85, marginTop: 2, letterSpacing: 0.3,
          }}>
            egress destination · {multiTenant ? `${selectedTenants.length} tenants` : 'live'}
          </div>
        </div>
        <button onClick={onClose} style={{
          all: 'unset', cursor: 'pointer',
          width: 24, height: 24, borderRadius: 5,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 18, lineHeight: 1,
          opacity: 0.85,
        }}>×</button>
      </div>

      {/* Two stat tiles */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        borderBottom: `1px solid ${NQ.border}`,
      }}>
        <DetailStat
          label="Error rate"
          value={detail.errorRate.toFixed(1) + '%'}
          tone={errorTone}
          sub="last 30 min"
        />
        <DetailStat
          label="Processed responses"
          value={detail.processed30m.toLocaleString()}
          sub="last 30 min"
          border
        />
      </div>

      {/* Scrollable section: Last 50 events */}
      <DetailSection
        title="Last 50 events"
        count={events.length}
        paused={paused}
        events={events}
        onOpenRequest={onOpenRequest}
        openRequest={openRequest}
        flex={1.4}
        multiTenant={multiTenant}
      />

      {/* Last 20 errors */}
      <DetailSection
        title="Last 20 errors"
        count={errors.length}
        paused={paused}
        events={errors}
        onOpenRequest={onOpenRequest}
        openRequest={openRequest}
        flex={1}
        tone="error"
        multiTenant={multiTenant}
      />
    </>
  );
}

function DetailStat({ label, value, sub, tone, border }) {
  return (
    <div style={{
      padding: '12px 16px',
      borderLeft: border ? `1px solid ${NQ.border}` : 'none',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
        textTransform: 'uppercase', color: NQ.textDim,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 22, fontWeight: 700, letterSpacing: -0.3,
        color: tone || NQ.text,
        fontFamily: '"Inter Tight", ui-sans-serif',
      }}>
        {value}
      </span>
      <span style={{
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 10, color: NQ.textDim,
      }}>
        {sub}
      </span>
    </div>
  );
}

function DetailSection({ title, count, paused, events, onOpenRequest, openRequest, flex = 1, tone, multiTenant }) {
  return (
    <div style={{
      flex, minHeight: 0,
      display: 'flex', flexDirection: 'column',
      borderTop: `1px solid ${NQ.border}`,
    }}>
      <div style={{
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: `1px solid ${NQ.border}`,
        background: NQ.pageBg,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: NQ.text, letterSpacing: 0.3,
        }}>
          {title}
        </span>
        <span style={{
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 10, fontWeight: 700, color: tone === 'error' ? NQ.red : NQ.textMid,
          padding: '1px 6px', borderRadius: 4,
          background: tone === 'error' ? `${NQ.red}14` : '#fff',
          border: `1px solid ${tone === 'error' ? `${NQ.red}33` : NQ.border}`,
        }}>
          {count}
        </span>
        <span style={{ flex: 1 }}/>
        {!paused && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 9.5, color: NQ.green,
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: 3, background: NQ.green,
              animation: 'cockpitBlink 1.4s ease-in-out infinite',
            }}/>
            live
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {events.length === 0 && (
          <div style={{ padding: '24px 16px', fontSize: 11.5, color: NQ.textDim, textAlign: 'center' }}>
            No events.
          </div>
        )}
        {events.map(e => (
          <EventRow key={e.id} ev={e} active={openRequest && openRequest.id === e.id}
            onClick={() => onOpenRequest(e)}
            forceError={tone === 'error'}
            multiTenant={multiTenant}
          />
        ))}
      </div>
    </div>
  );
}

function statusTone(http) {
  if (http >= 500) return { c: NQ.red,   bg: `${NQ.red}14` };
  if (http >= 400) return { c: NQ.red,   bg: `${NQ.red}10` };
  if (http >= 300) return { c: NQ.amber, bg: `${NQ.amber}14` };
  return                  { c: NQ.green, bg: `${NQ.green}14` };
}

function EventRow({ ev, active, onClick, forceError, multiTenant }) {
  const t = statusTone(ev.http);
  const tenant = ev.tenant ? TENANT_BY_ID[ev.tenant] : null;
  return (
    <button onClick={onClick} style={{
      all: 'unset', cursor: 'pointer',
      display: 'flex', gap: 10, alignItems: 'flex-start',
      width: '100%', boxSizing: 'border-box',
      padding: '8px 16px',
      borderBottom: `1px solid ${NQ.border}`,
      background: active ? '#fff7fb' : (forceError ? '#fffafa' : '#fff'),
      borderLeft: active ? `3px solid ${NQ.pink}` : '3px solid transparent',
    }}>
      <span style={{
        flexShrink: 0,
        padding: '1px 6px', borderRadius: 4,
        background: t.bg, color: t.c,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 10.5, fontWeight: 700,
        marginTop: 1,
      }}>
        {ev.http}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 11.5, color: ev.err ? NQ.red : NQ.text,
          fontWeight: 600, lineHeight: 1.3,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span>Request <span style={{ color: NQ.text, fontWeight: 700 }}>{ev.id.slice(-7)}</span></span>
          {multiTenant && tenant && (
            <span title={tenant.label} style={{
              marginLeft: 'auto',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '1px 5px 1px 4px', borderRadius: 4,
              border: `1px solid ${NQ.border}`, background: '#fff',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: 4, background: tenant.color }}/>
              <span style={{
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 9.5, fontWeight: 700, color: NQ.textMid, letterSpacing: 0.2,
              }}>
                {tenant.id.split('-')[0]}
              </span>
            </span>
          )}
        </div>
        <div style={{
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 10, color: NQ.textMid, marginTop: 2,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ color: NQ.textDim }}>flow</span>
          <span style={{ color: NQ.text, fontWeight: 600 }}>{ev.flow}</span>
          <span style={{ color: NQ.textDim }}>·</span>
          <span>{ev.t}</span>
        </div>
      </div>
    </button>
  );
}

// ---------- All-integrations panel (when nothing is selected) --------------
function AllIntegrationsPanel({ paused, onSelectNode }) {
  const all = [...CK.named].sort((a, b) => b.rate - a.rate);
  return (
    <>
      <div style={{
        padding: '14px 16px',
        borderBottom: `1px solid ${NQ.border}`,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: NQ.text }}>All integrations</div>
        <div style={{ fontSize: 11, color: NQ.textMid, marginTop: 2 }}>
          Click a node on the map to see its requests, error rate, and recent events.
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {all.map(n => {
          const t = n.status === 'red' ? NQ.red : n.status === 'amber' ? NQ.amber : NQ.green;
          return (
            <button key={n.id} onClick={() => onSelectNode(n.id)} style={{
              all: 'unset', cursor: 'pointer', width: '100%',
              boxSizing: 'border-box', padding: '8px 16px',
              borderBottom: `1px solid ${NQ.border}`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 5, background: t,
                boxShadow: n.status !== 'green' ? `0 0 0 3px ${t}22` : 'none' }}/>
              <span style={{ fontSize: 12, fontWeight: 600, color: NQ.text, flex: 1 }}>{n.id}</span>
              <span style={{
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 11, fontWeight: 700, color: NQ.textMid,
              }}>
                {n.rate}/m
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ---------- Request popover (floats over the topology pane) ----------------
function RequestPopover({ ev, destination, onClose, style, multiTenant }) {
  const [advanced, setAdvanced] = React.useState(true);
  const t = statusTone(ev.http);
  const statusText = HTTP_STATUS_TEXT[ev.http] || '';
  const tenant = ev.tenant ? TENANT_BY_ID[ev.tenant] : null;
  return (
    <div style={{
      ...style,
      background: '#fff',
      border: `1px solid ${NQ.border}`,
      borderRadius: 10,
      boxShadow: '0 1px 2px rgba(20,25,38,0.06), 0 12px 32px rgba(20,25,38,0.12)',
      overflow: 'hidden',
      fontFamily: 'inherit',
    }}>
      <div style={{
        padding: '12px 14px',
        borderBottom: `1px solid ${NQ.border}`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 11, color: NQ.textDim, fontWeight: 600,
        }}>
          Request
        </span>
        <span style={{
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 11.5, color: NQ.text, fontWeight: 700,
        }}>
          {ev.id}
        </span>
        <span style={{ flex: 1 }}/>
        <button onClick={onClose} style={{
          all: 'unset', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 8px', borderRadius: 5,
          fontSize: 11, fontWeight: 700, color: NQ.pink,
          border: `1px solid ${NQ.pink}`,
        }}>
          <span style={{ fontSize: 14, lineHeight: 1, marginTop: -1 }}>×</span>
          Close
        </button>
      </div>

      <div style={{ padding: '12px 14px' }}>
        <PopRow label="HTTP STATUS">
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              padding: '1px 7px', borderRadius: 4,
              background: t.bg, color: t.c,
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              fontSize: 11, fontWeight: 700,
            }}>
              {ev.http}
            </span>
            <span style={{ fontSize: 12, color: NQ.text }}>{statusText}</span>
          </span>
        </PopRow>
        <PopRow label="FLOW">
          <span style={{
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 12, color: NQ.text, fontWeight: 600,
          }}>
            {ev.flow}
          </span>
        </PopRow>
        <PopRow label="DESTINATION">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: NQ.pink }}/>
            <span style={{ fontSize: 12, color: NQ.text, fontWeight: 600 }}>{destination}</span>
          </span>
        </PopRow>
        {multiTenant && tenant && (
          <PopRow label="TENANT">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 5, background: tenant.color,
                boxShadow: `0 0 0 3px ${tenant.color}22` }}/>
              <span style={{ fontSize: 12, color: NQ.text, fontWeight: 600 }}>{tenant.label}</span>
              <span style={{
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 10, color: NQ.textDim,
              }}>
                {tenant.id}
              </span>
            </span>
          </PopRow>
        )}

        <button onClick={() => setAdvanced(a => !a)} style={{
          all: 'unset', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          marginTop: 10, padding: '4px 8px', borderRadius: 5,
          fontSize: 11, fontWeight: 700, color: NQ.pink,
          border: `1px solid ${NQ.pink}`,
        }}>
          <NqIcon name="chevronDown" size={11}
            color={NQ.pink}
            style={{ transform: advanced ? 'rotate(180deg)' : 'none' }}/>
          {advanced ? 'Hide advanced' : 'Show advanced'}
        </button>

        {advanced && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${NQ.border}` }}>
            <PopRow label="TTFB">
              <span style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 12 }}>
                {ev.ttfb != null ? `${ev.ttfb} ms` : '—'}
              </span>
            </PopRow>
            <PopRow label="PAYLOAD SIZE">
              <span style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 12 }}>
                {ev.payload != null ? formatBytes(ev.payload) : '—'}
              </span>
            </PopRow>
            <PopRow label="RESPONSE SIZE">
              <span style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 12 }}>
                {ev.response != null ? formatBytes(ev.response) : '—'}
              </span>
            </PopRow>
          </div>
        )}
      </div>
    </div>
  );
}

function PopRow({ label, children }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '110px 1fr',
      alignItems: 'center', padding: '5px 0',
    }}>
      <span style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6,
        textTransform: 'uppercase', color: NQ.textDim,
      }}>
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}

function formatBytes(n) {
  if (n < 1024) return `${n} bytes`;
  return `${(n / 1024).toFixed(1)} kB`;
}

const HTTP_STATUS_TEXT = {
  200: 'OK',
  204: 'No Content',
  301: 'Moved Permanently',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

// Small "egress only" indicator pinned to the topology pane.
function EgressBadge() {
  return (
    <div style={{
      position: 'absolute', right: 16, bottom: 16,
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '6px 10px',
      background: '#fff',
      border: `1px solid ${NQ.border}`,
      borderRadius: 6,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 9.5, letterSpacing: 0.6, color: NQ.textMid, fontWeight: 600,
    }}>
      <NqIcon name="arrowRight" size={11} color={NQ.pink}/>
      EGRESS ONLY
    </div>
  );
}

// ---------- Bottom timeline (unchanged from v1, lightly tuned) -------------
function CockpitTimeline({ date, setDate, scrub, setScrub, time, speed, setSpeed }) {
  const trackRef = React.useRef(null);
  const drag = React.useRef(false);

  const onDown = (e) => { drag.current = true; onMove(e); };
  const onMove = (e) => {
    if (!drag.current && e.type !== 'mousedown') return;
    const r = trackRef.current.getBoundingClientRect();
    const x = (e.clientX || (e.touches && e.touches[0].clientX)) - r.left;
    setScrub(Math.max(0, Math.min(1, x / r.width)));
  };
  const onUp = () => { drag.current = false; };

  React.useEffect(() => {
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  });

  return (
    <div style={{
      borderTop: `1px solid ${NQ.border}`,
      background: '#fff',
      padding: '10px 20px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          display: 'flex', alignItems: 'stretch',
          border: `1px solid ${NQ.border}`, borderRadius: 7, overflow: 'hidden',
        }}>
          <button style={tlBtn}>
            <NqIcon name="chevronDown" size={12} color={NQ.textMid} style={{ transform: 'rotate(90deg)' }}/>
          </button>
          <span style={{
            padding: '5px 12px', borderLeft: `1px solid ${NQ.border}`, borderRight: `1px solid ${NQ.border}`,
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 12, color: NQ.text, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <NqIcon name="clock" size={12} color={NQ.textMid}/>
            {date}
          </span>
          <button style={tlBtn}>
            <NqIcon name="chevronDown" size={12} color={NQ.textMid} style={{ transform: 'rotate(-90deg)' }}/>
          </button>
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {['15m', '1h', '6h', '24h'].map(r => (
            <button key={r} style={{
              all: 'unset',
              padding: '4px 8px', borderRadius: 5,
              fontSize: 11, fontWeight: 600, color: r === '24h' ? '#fff' : NQ.textMid,
              background: r === '24h' ? NQ.sidebarBg : 'transparent',
              cursor: 'pointer',
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            }}>{r}</button>
          ))}
        </div>

        <SpeedControl speed={speed} setSpeed={setSpeed}/>

        <span style={{ flex: 1 }}/>

        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 11, color: NQ.textMid,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: NQ.pink, boxShadow: `0 0 0 3px ${NQ.pink}22` }}/>
          playhead
        </span>
        <span style={{
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 13, fontWeight: 700, color: NQ.text,
          padding: '4px 10px', background: NQ.pageBg, borderRadius: 5,
        }}>
          {time}
        </span>
      </div>

      <div
        ref={trackRef}
        onMouseDown={onDown}
        style={{
          position: 'relative', height: 26, cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 12,
          height: 2, background: NQ.border, borderRadius: 1,
        }}/>
        {Array.from({ length: 25 }).map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${(i / 24) * 100}%`,
            top: i % 6 === 0 ? 6 : 9,
            width: 1,
            height: i % 6 === 0 ? 14 : 8,
            background: i % 6 === 0 ? NQ.borderStrong : NQ.border,
          }}/>
        ))}
        {[0, 6, 12, 18, 24].map(h => (
          <span key={h} style={{
            position: 'absolute',
            left: `${(h / 24) * 100}%`, top: 21,
            transform: 'translateX(-50%)',
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 9, color: NQ.textDim, fontWeight: 600,
          }}>
            {String(h).padStart(2, '0')}:00
          </span>
        ))}
        <div style={{
          position: 'absolute', left: 0, top: 12,
          width: `${scrub * 100}%`, height: 2,
          background: NQ.pink, borderRadius: 1,
        }}/>
        {/* signal-trigger markers along the day */}
        {CK.signals.map((s, i) => {
          const c = s.level === 'error' ? NQ.red
                  : s.level === 'warning' ? NQ.amber
                  : s.level === 'ok' ? NQ.green
                  : NQ.pink;
          return (
            <div key={i} title={`${s.t} · ${s.name}`}
              style={{
                position: 'absolute', left: `${s.scrub * 100}%`, top: 8,
                transform: 'translateX(-50%)',
                width: 6, height: 10, borderRadius: 2,
                background: c,
                opacity: s.scrub < scrub ? 0.85 : 0.4,
                cursor: 'pointer',
              }}/>
          );
        })}
        <div style={{
          position: 'absolute', left: `${scrub * 100}%`, top: 0,
          transform: 'translateX(-50%)',
          width: 12, height: 26,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}>
          <div style={{
            width: 12, height: 12, borderRadius: 7, background: NQ.pink,
            border: '2px solid #fff', boxShadow: '0 1px 4px rgba(229,36,125,0.5)',
            marginTop: 1,
          }}/>
          <div style={{
            width: 1.5, height: 14, background: NQ.pink, opacity: 0.5, marginTop: -1,
          }}/>
        </div>
      </div>
    </div>
  );
}

const tlBtn = {
  all: 'unset',
  padding: '5px 8px',
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: NQ.textMid,
};

// ---------- Playback speed slider (snaps to 5 stops) -----------------------
// Left = slower viewing (each request rendered longer, easier to inspect).
// Right = faster (compresses time). 1× sits one stop from the right.
const COCKPIT_SPEEDS = [
  { v: 10,  label: '10×',  sub: 'slow-mo' },
  { v: 5,   label: '5×',   sub: '' },
  { v: 2,   label: '2×',   sub: '' },
  { v: 1,   label: '1×',   sub: 'realtime' },
  { v: 0.5, label: '0.5×', sub: 'fast forward' },
];

function SpeedControl({ speed, setSpeed }) {
  const idx = Math.max(0, COCKPIT_SPEEDS.findIndex(s => s.v === speed));
  const realtimeIdx = COCKPIT_SPEEDS.findIndex(s => s.v === 1);
  const lastIdx = COCKPIT_SPEEDS.length - 1;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      padding: '4px 12px',
      border: `1px solid ${NQ.border}`, borderRadius: 7,
      background: '#fff',
    }}>
      <span style={{
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 9, fontWeight: 700, letterSpacing: 0.6,
        textTransform: 'uppercase', color: NQ.textDim,
      }}>
        Replay
      </span>

      {/* End-anchor: slower (left) */}
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 10, fontWeight: 600, color: NQ.textMid, letterSpacing: 0.2,
      }}>
        <NqIcon name="arrowRight" size={11} color={NQ.textMid}
          style={{ transform: 'scaleX(-1)' }}/>
        slower
      </span>

      {/* Slider */}
      <div style={{
        position: 'relative',
        width: 200, height: 28, flexShrink: 0,
      }}>
        {/* track */}
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 12,
          height: 3, background: NQ.border, borderRadius: 2,
        }}/>
        {/* highlight bar between realtime and the current position */}
        <div style={{
          position: 'absolute', top: 12,
          left:  `${(Math.min(idx, realtimeIdx) / lastIdx) * 100}%`,
          width: `${(Math.abs(idx - realtimeIdx) / lastIdx) * 100}%`,
          height: 3, background: NQ.pink, borderRadius: 2,
        }}/>
        {/* tick stops + click targets */}
        {COCKPIT_SPEEDS.map((s, i) => {
          const left = `${(i / lastIdx) * 100}%`;
          const on = i === idx;
          return (
            <button key={s.v} onClick={() => setSpeed(s.v)}
              title={`${s.label}${s.sub ? ' · ' + s.sub : ''}`}
              style={{
                all: 'unset', cursor: 'pointer',
                position: 'absolute', top: 0, left,
                transform: 'translateX(-50%)',
                width: 24, height: 28,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
              }}>
              {on ? (
                <span style={{
                  width: 12, height: 12, borderRadius: 8, marginTop: 8,
                  background: NQ.pink, border: '2px solid #fff',
                  boxShadow: `0 0 0 1px ${NQ.pink}, 0 1px 4px rgba(229,36,125,0.45)`,
                }}/>
              ) : (
                <span style={{
                  width: 7, height: 7, borderRadius: 4, marginTop: 10,
                  background: NQ.borderStrong,
                }}/>
              )}
              <span style={{
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 9, fontWeight: 700, marginTop: 3,
                color: on ? NQ.pink : NQ.textDim, letterSpacing: 0.2,
              }}>
                {s.label}
              </span>
            </button>
          );
        })}

        {/* "realtime" anchor tick label above the 1× stop */}
        <span style={{
          position: 'absolute',
          left: `${(realtimeIdx / lastIdx) * 100}%`,
          top: -10, transform: 'translateX(-50%)',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 8, fontWeight: 700, color: NQ.textDim, letterSpacing: 0.4,
          textTransform: 'uppercase', pointerEvents: 'none',
        }}>
          realtime
        </span>
      </div>

      {/* End-anchor: faster (right) */}
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 10, fontWeight: 600, color: NQ.textMid, letterSpacing: 0.2,
      }}>
        faster
        <NqIcon name="arrowRight" size={11} color={NQ.textMid}/>
      </span>
    </div>
  );
}

// Inject keyframes
(function injectCockpitKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cockpit-kf')) return;
  const s = document.createElement('style');
  s.id = 'cockpit-kf';
  s.textContent = `
    @keyframes cockpitRing { to { transform: rotate(360deg); } }
    @keyframes cockpitBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
  `;
  document.head.appendChild(s);
})();

Object.assign(window, { CockpitPage });
