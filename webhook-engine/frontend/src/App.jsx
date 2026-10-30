import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const STATUS_LABEL = { SUCCEEDED: 'Delivered', RETRYING: 'Retrying', FAILED: 'Failed', PENDING: 'Queued' };
const STATUS_FILTERS = [
  ['', 'All deliveries'],
  ['SUCCEEDED', 'Delivered'],
  ['RETRYING', 'Retrying'],
  ['FAILED', 'Failed'],
  ['PENDING', 'Queued'],
];
const POLL_MS = 3000;

const formatTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '-';

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function Countdown({ iso }) {
  const now = useNow();
  if (!iso) return <span className="muted">-</span>;
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  if (seconds <= 0) return <span>due now</span>;
  const minutes = Math.floor(seconds / 60);
  return <span>in {minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`}</span>;
}

/** One segment per allowed attempt: red = failed attempt, green = delivered, hollow = not used yet. */
function AttemptTrack({ count, max, status }) {
  return (
    <span className="track" role="img" aria-label={`${count} of ${max} attempts used`}>
      <span className="segments">
        {Array.from({ length: max }, (_, i) => {
          const state = i >= count ? 'idle' : status === 'SUCCEEDED' && i === count - 1 ? 'ok' : 'fail';
          return <i key={i} className={`seg ${state}`} />;
        })}
      </span>
      <span className="track-count">{count}/{max}</span>
    </span>
  );
}

function StatusBadge({ status }) {
  return <span className={`badge ${status.toLowerCase()}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function AttemptDetail({ deliveryId, updatedAt }) {
  const [delivery, setDelivery] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getDelivery(deliveryId)
      .then((d) => !cancelled && setDelivery(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [deliveryId, updatedAt]);

  if (error) return <p className="inline-error">{error}</p>;
  if (!delivery) return <p className="muted">Loading attempts</p>;
  if (delivery.attempts.length === 0) return <p className="muted">No attempts yet. The first one is queued.</p>;

  return (
    <ol className="attempts">
      {delivery.attempts.map((a) => (
        <li key={a.id}>
          <span className={`dot ${a.success ? 'ok' : 'fail'}`} />
          <span className="attempt-title">
            Attempt {a.attempt_number}: {a.status_code ? `HTTP ${a.status_code}` : 'no response'} in {a.duration_ms} ms
          </span>
          <span className="muted">{formatTime(a.created_at)}</span>
          {a.error && <span className="attempt-error">{a.error}</span>}
          {a.response_snippet && <code className="snippet">{a.response_snippet}</code>}
        </li>
      ))}
    </ol>
  );
}

function DeliveryRow({ delivery, expanded, onToggle, onRedeliver, busy }) {
  const canRedeliver = delivery.status === 'SUCCEEDED' || delivery.status === 'FAILED';
  return (
    <>
      <tr className={expanded ? 'open' : ''}>
        <td className="nowrap">{formatTime(delivery.created_at)}</td>
        <td>
          <div className="mono strong">{delivery.event_type}</div>
          <div className="mono muted small">{delivery.event_id.slice(0, 8)}</div>
        </td>
        <td className="mono url" title={delivery.endpoint_url}>{delivery.endpoint_url}</td>
        <td><StatusBadge status={delivery.status} /></td>
        <td className="mono">
          {delivery.last_status_code ?? <span className="muted" title={delivery.last_error ?? ''}>none</span>}
        </td>
        <td><AttemptTrack count={delivery.attempt_count} max={delivery.max_attempts} status={delivery.status} /></td>
        <td className="nowrap">
          {delivery.status === 'RETRYING' ? <Countdown iso={delivery.next_attempt_at} /> : <span className="muted">-</span>}
        </td>
        <td className="actions">
          <button type="button" className="link" onClick={onToggle} aria-expanded={expanded}>
            {expanded ? 'Hide attempts' : 'Attempts'}
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!canRedeliver || busy}
            title={canRedeliver ? 'Send this event again' : 'Already queued or in progress'}
            onClick={onRedeliver}
          >
            Re-deliver
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="detail">
          <td colSpan={8}>
            <AttemptDetail deliveryId={delivery.id} updatedAt={delivery.updated_at} />
          </td>
        </tr>
      )}
    </>
  );
}

function EndpointForm({ onCreated, onError }) {
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [eventTypes, setEventTypes] = useState('*');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await api.createEndpoint({
        url: url.trim(),
        ...(description.trim() && { description: description.trim() }),
        event_types: eventTypes.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setUrl('');
      setDescription('');
      setEventTypes('*');
      onCreated(created);
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <label>
        Endpoint URL
        <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/webhooks" />
      </label>
      <label>
        Description
        <input value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="Billing service" />
      </label>
      <label>
        Event types
        <input value={eventTypes} onChange={(e) => setEventTypes(e.target.value)} placeholder="order.created, order.paid" />
        <span className="hint">Comma-separated. Use * to receive every event.</span>
      </label>
      <button className="btn primary" disabled={saving}>{saving ? 'Adding' : 'Add endpoint'}</button>
    </form>
  );
}

function SecretBox({ secret, label }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="secret">
      <span className="small muted">{label}</span>
      <code>{secret}</code>
      <button type="button" className="link" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

function EndpointItem({ endpoint, onChanged, onError }) {
  const [secret, setSecret] = useState(null);

  async function toggleSecret() {
    if (secret) return setSecret(null);
    try {
      setSecret(await api.revealSecret(endpoint.id));
    } catch (err) {
      onError(err.message);
    }
  }
  async function toggleActive() {
    try {
      await api.updateEndpoint(endpoint.id, { is_active: !endpoint.is_active });
      onChanged();
    } catch (err) {
      onError(err.message);
    }
  }
  async function remove() {
    if (!window.confirm('Delete this endpoint and its delivery history?')) return;
    try {
      await api.deleteEndpoint(endpoint.id);
      onChanged();
    } catch (err) {
      onError(err.message);
    }
  }

  return (
    <li className={`endpoint ${endpoint.is_active ? '' : 'paused'}`}>
      <div className="mono url strong" title={endpoint.url}>{endpoint.url}</div>
      <div className="small muted">
        {endpoint.description || 'No description'} {!endpoint.is_active && '(paused)'}
      </div>
      <div className="chips">{endpoint.event_types.map((t) => <span key={t} className="chip mono">{t}</span>)}</div>
      {secret && <SecretBox secret={secret} label="Signing secret" />}
      <div className="row">
        <button type="button" className="link" onClick={toggleSecret}>{secret ? 'Hide secret' : 'Show secret'}</button>
        <button type="button" className="link" onClick={toggleActive}>{endpoint.is_active ? 'Pause' : 'Resume'}</button>
        <button type="button" className="link danger" onClick={remove}>Delete</button>
      </div>
    </li>
  );
}

function TestEventForm({ onSent, onError }) {
  const [eventType, setEventType] = useState('order.created');
  const [sending, setSending] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSending(true);
    try {
      await api.sendEvent({
        event_type: eventType.trim(),
        payload: { order_id: `ord_${Math.random().toString(36).slice(2, 8)}`, amount: 4200, currency: 'usd', sent_at: new Date().toISOString() },
      });
      onSent();
    } catch (err) {
      onError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <label>
        Event type
        <input required value={eventType} onChange={(e) => setEventType(e.target.value)} />
      </label>
      <button className="btn" disabled={sending}>{sending ? 'Sending' : 'Send test event'}</button>
    </form>
  );
}

export default function App() {
  const [endpoints, setEndpoints] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [limit, setLimit] = useState(25);
  const [live, setLive] = useState(true);
  const [error, setError] = useState(null);
  const [newSecret, setNewSecret] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const loadEndpoints = useCallback(() => api.listEndpoints().then(setEndpoints).catch((e) => setError(e.message)), []);
  const loadDeliveries = useCallback(
    () =>
      api
        .listDeliveries({ status: statusFilter, limit })
        .then((d) => {
          setDeliveries(d);
          setError(null);
          setLoaded(true);
        })
        .catch((e) => setError(e.message)),
    [statusFilter, limit],
  );

  useEffect(() => { loadEndpoints(); }, [loadEndpoints]);

  useEffect(() => {
    loadDeliveries();
    if (!live) return undefined;
    const id = setInterval(loadDeliveries, POLL_MS);
    return () => clearInterval(id);
  }, [loadDeliveries, live]);

  async function redeliver(id) {
    setBusyId(id);
    try {
      await api.redeliver(id);
      await loadDeliveries();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Webhook deliveries</h1>
          <p className="muted">Every event we sent to your endpoints, and what they answered.</p>
        </div>
        <button type="button" className={`live ${live ? 'on' : ''}`} onClick={() => setLive((v) => !v)} aria-pressed={live}>
          <span className="pulse" />
          {live ? 'Live, refreshing every 3s' : 'Paused'}
        </button>
      </header>

      {error && <div className="banner" role="alert">{error}<button type="button" className="link" onClick={() => setError(null)}>Dismiss</button></div>}

      <div className="layout">
        <aside className="rail">
          <section className="panel">
            <h2>Add an endpoint</h2>
            <EndpointForm
              onCreated={(created) => { setNewSecret(created); loadEndpoints(); }}
              onError={setError}
            />
            {newSecret && (
              <div className="callout">
                <strong>Endpoint added.</strong> Use this secret to verify the <span className="mono">X-Webhook-Signature</span> header.
                <SecretBox secret={newSecret.secret_key} label="Signing secret" />
                <button type="button" className="link" onClick={() => setNewSecret(null)}>Dismiss</button>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Your endpoints</h2>
            {endpoints.length === 0 ? (
              <p className="muted">No endpoints yet. Add one above to start receiving events.</p>
            ) : (
              <ul className="endpoints">
                {endpoints.map((ep) => (
                  <EndpointItem key={ep.id} endpoint={ep} onChanged={() => { loadEndpoints(); loadDeliveries(); }} onError={setError} />
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>Send a test event</h2>
            <TestEventForm onSent={loadDeliveries} onError={setError} />
          </section>
        </aside>

        <main className="log panel">
          <div className="log-head">
            <h2>Delivery log</h2>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              {STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th><th>Event</th><th>Endpoint</th><th>Status</th><th>HTTP</th><th>Attempts</th><th>Next retry</th><th><span className="sr">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <DeliveryRow
                    key={d.id}
                    delivery={d}
                    expanded={expandedId === d.id}
                    busy={busyId === d.id}
                    onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)}
                    onRedeliver={() => redeliver(d.id)}
                  />
                ))}
              </tbody>
            </table>
            {loaded && deliveries.length === 0 && (
              <p className="empty">Nothing here yet. Send a test event and it will show up within seconds.</p>
            )}
          </div>

          {deliveries.length >= limit && limit < 100 && (
            <button type="button" className="btn more" onClick={() => setLimit((l) => Math.min(l + 25, 100))}>Show more</button>
          )}
        </main>
      </div>
    </div>
  );
}
