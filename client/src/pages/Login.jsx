import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useTitle } from '../ui.jsx';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('rahul.sharma@prestigehomes.in');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [hints, setHints] = useState(null);
  useTitle('Sign in');

  useEffect(() => {
    api.get('/api/auth/demo-hints').then(setHints).catch(() => setHints(null));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const user = await login(email, password || hints?.password || '', remember);
      navigate(user.realm === 'platform' ? '/platform' : '/app');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login">
      <section className="login-story">
        <div className="login-brand">
          <span className="mark" aria-hidden="true">
            <svg viewBox="0 0 32 32"><path d="M6 26 L16 5 L26 26 H21.2 L16 14.2 L10.8 26 Z" fill="currentColor" /></svg>
          </span>
          <span>AIRO</span>
        </div>
        <div>
          <p className="eyebrow">Operating intelligence</p>
          <h1>Real estate, read as a business.</h1>
          <p className="login-lead">Campaigns, portals, calls and pipeline in one workspace. The sources stay in Connections.</p>
        </div>
        <p className="login-foot">NCR desk · Sector 62 to Dwarka Expressway</p>
      </section>
      <section className="login-form">
        <form className="login-card form-grid" onSubmit={submit}>
          <p className="eyebrow">Sign in</p>
          <h2>Enter the workspace.</h2>
          <p className="quiet">Platform administration and client workspaces use different accounts.</p>
          <label className="stack-field">Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" />
          </label>
          <label className="stack-field">Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required={false} autoComplete="current-password" placeholder={hints ? 'Development password is filled on submit if empty' : ''} />
          </label>
          <label className="remember-field">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            Remember me
          </label>
          {error ? <p className="delta-down">{error}</p> : null}
          <button className="btn-primary" type="submit">Continue</button>
          <Link to="/reset-password">Reset password</Link>
          {hints ? (
            <details className="hints">
              <summary>Development accounts</summary>
              <p>Password: {hints.password}</p>
              <p>Workspace: {hints.client}</p>
              <p>Platform: {hints.platform}</p>
              {hints.others.map(([address, role]) => <p key={address}>{address} — {role}</p>)}
            </details>
          ) : null}
        </form>
      </section>
    </div>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const token = params.get('token');
  useTitle('Reset password');

  async function submit(event) {
    event.preventDefault();
    const data = token
      ? await api.post('/api/auth/password/reset', { token, password })
      : await api.post('/api/auth/password/forgot', { email });
    setMessage(data.message);
  }

  return (
    <div className="login">
      <section className="login-story"><h1>Reset access.</h1></section>
      <section className="login-form">
        <form className="login-card form-grid" onSubmit={submit}>
          <h2>{token ? 'Choose a password' : 'Request a reset'}</h2>
          {token ? (
            <label className="stack-field">New password
              <input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>
          ) : (
            <label className="stack-field">Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
          )}
          {message ? <p>{message}</p> : null}
          <button className="btn-primary" type="submit">{token ? 'Update password' : 'Send reset'}</button>
          <Link to="/login">Back to sign in</Link>
        </form>
      </section>
    </div>
  );
}
