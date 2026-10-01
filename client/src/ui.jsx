import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { inr, label, num } from './format.js';

export function useSection(items) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('section');
  const current = items.includes(requested) ? requested : items[0];
  function select(section) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('section', section);
      return next;
    }, { replace: true });
  }
  return [current, select];
}

export function Subnav({ items, value, onChange }) {
  return (
    <div className="tabs subnav" role="tablist" aria-label="Submodules">
      {items.map((item) => (
        <button key={item} type="button" role="tab" aria-selected={value === item} className={value === item ? 'is-on' : ''} onClick={() => onChange(item)}>{item}</button>
      ))}
    </div>
  );
}

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · AIRO` : 'AIRO';
  }, [title]);
}

export function Page({ eyebrow, title, lede, actions, children }) {
  useTitle(title);
  return (
    <section>
      <header className="page-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {lede ? <p className="lede">{lede}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function State({ loading, error, empty, onRetry, children }) {
  if (loading) return <div className="skeleton-block" aria-busy="true" aria-label="Loading" />;
  if (error) {
    return (
      <div className="error-box">
        <strong>This view could not be loaded.</strong>
        <p className="quiet">{error}</p>
        {onRetry ? <button className="btn" onClick={onRetry}>Try again</button> : null}
      </div>
    );
  }
  if (empty) {
    return (
      <div className="empty">
        <strong>{empty.title}</strong>
        <p className="quiet">{empty.body}</p>
      </div>
    );
  }
  return children;
}

export function Badge({ value, tone }) {
  const map = {
    connected: 'good', active: 'good', paid: 'good', succeeded: 'good', won: 'good', booked: 'good', qualified: 'good',
    error: 'bad', failed: 'bad', lost: 'bad', suspended: 'bad', high: 'bad', critical: 'bad',
    degraded: 'warn', pending: 'warn', waiting: 'warn', open: 'warn', watch: 'warn', past_due: 'warn', paused: 'warn',
    new: 'info', info: 'info'
  };
  return <span className={`badge ${tone || map[value] || ''}`}>{label(value)}</span>;
}

export function MetricStrip({ items }) {
  return (
    <div className="metric-strip">
      {items.map((item) => (
        <div className="metric" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.format === 'inr' ? (item.value == null ? '—' : inr(item.value)) : num(item.value)}</strong>
          <em>
            {item.delta == null ? item.hint : (
              <span className={item.delta >= 0 ? 'delta-up' : 'delta-down'}>
                {item.delta > 0 ? '+' : ''}{item.delta}%
              </span>
            )}
            {item.delta != null && item.hint ? ` · ${item.hint}` : ''}
          </em>
        </div>
      ))}
    </div>
  );
}

export function Table({ columns, rows, onRow }) {
  return (
    <div className="table-wrap">
      <table className="responsive">
        <thead>
          <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length}>No records in this submodule.</td></tr>
          ) : null}
          {rows.map((row) => (
            <tr
              key={row.id || row.slug || row.label}
              className={onRow ? 'is-clickable' : ''}
              onClick={onRow ? () => onRow(row) : undefined}
              onKeyDown={onRow ? (event) => { if (event.key === 'Enter') onRow(row); } : undefined}
              tabIndex={onRow ? 0 : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} data-label={column.label}>{column.render ? column.render(row) : row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LineChart({ points, field = 'leads' }) {
  const values = points.map((point) => Number(point[field] || 0));
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? 100 / (values.length - 1) : 100;
  const coords = values.map((value, index) => `${index * step},${100 - (value / max) * 86 - 6}`);
  const line = coords.join(' ');
  const area = `0,100 ${line} 100,100`;
  return (
    <svg className="chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Trend">
      <line x1="0" y1="94" x2="100" y2="94" stroke="#e7dfd4" strokeWidth="0.4" />
      <polygon className="area" points={area} />
      <polyline points={line} />
    </svg>
  );
}

export function Funnel({ rows }) {
  const max = Math.max(...rows.map((row) => Number(row.total || 0)), 1);
  return (
    <div className="funnel">
      {rows.map((row) => (
        <div className="funnel-row" key={row.status}>
          <span>{label(row.status)}</span>
          <div className="funnel-track"><span style={{ width: `${(Number(row.total) / max) * 100}%` }} /></div>
          <strong>{row.total}</strong>
        </div>
      ))}
    </div>
  );
}

export function Insight({ item, action }) {
  return (
    <article className="panel">
      <header>
        <h2>{item.title || item.answer}</h2>
        {item.severity || item.priority ? <Badge value={item.severity || item.priority} /> : null}
      </header>
      <p>{item.body || item.insight}</p>
      {item.evidence ? <p className="evidence quiet">{item.evidence}</p> : null}
      {action}
    </article>
  );
}
